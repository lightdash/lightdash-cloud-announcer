import { openai } from "@ai-sdk/openai";
import { Agent, createStep, createWorkflow, Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";
import type { MessageShortcut } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { z } from "zod";
import {
  conversationHistorySchema,
  getConversationHistory,
  type SlackRuntimeContext,
} from "./ai/steps/getConversationHistory.js";
import { getLabelsAndMilestones, labelsAndMilestonesSchema } from "./ai/steps/getToolsAndMilestones.js";
import { GH_OWNER, GH_REPO } from "./config.js";
import { RuntimeContext } from "@mastra/core/runtime-context";
import { slackTryJoin } from "./slack_utils.js";

export const draftIssues = ({
  channelId,
  threadOrMessageTs,
  client,
  user,
}: {
  channelId: string;
  threadOrMessageTs: string;
  client: WebClient;
  user: MessageShortcut["user"];
}) => {
  const cloudy008 = new Agent({
    model: openai("gpt-4.1", { structuredOutputs: true }),
    name: "Cloudy008",
    instructions: `You are Cloudy008, a helpful assistant that creates clear GitHub issue specs from Slack conversations.

  You help Lightdash support engineers by creating clear GitHub issue specs from Slack conversations.

  Your job:
  - Read the entire Slack thread.
  - Generate one or more GitHub issues with:
    - A concise, descriptive title.
    - A detailed description including key info, steps to reproduce (if bug), or feature details.
    - Suggested labels (like bug, feature request, customer support).
    - Always label it with Customer Support label.
  - If the conversation is about a bug, include a detailed description of the bug, and steps to reproduce.
  - if the conversation is about a feature request, include a detailed description of the feature, and why it's needed.
  - A good new issue consists of:
    - A concise, descriptive title, not all caps.
    - A few sentences of description.
    - Proper labels.
    - A milestone if you believe 99% that it belongs to a milestone.
  - A good new issue does not consist of:
    - PII data.
    - A new issue never includes content that is not relevant to the issue.
    - A new issue never includes conversation history.
  - Additional instructions:
    - Use code blocks and bullet point lists to make it more readable if needed.
    - ONLY USE SLACK FLAVOR OF MARKDOWN.

  Make sure the issue spec is clear and actionable.
  `,
  });

  const inputSchema = z.object({
    channelId: z.string().describe("The channel ID"),
    threadOrMessageTs: z.string().describe("The thread or message timestamp"),
    gh_owner: z.string().describe("The GitHub owner"),
    gh_repo: z.string().describe("The GitHub repository"),
  });

  const issuesSchema = z.object({
    issues: z.array(
      z.object({
        title: z.string().describe("Issue title"),
        description: z.string().describe("Detailed issue description"),
        labels: z.array(z.string()).describe("Labels for the issue"),
      }),
    ),
  });

  const outputSchema = z.object({
    created: z.boolean().describe("Whether the issues were created"),
  });

  const specIssues = createStep({
    id: "specIssues",
    description: "Create GitHub issues from the conversation history",
    inputSchema: z.object({
      getLabelsAndMilestones: labelsAndMilestonesSchema,
      getConversationHistory: conversationHistorySchema,
    }),
    outputSchema: issuesSchema,
    execute: async ({ inputData }) => {
      const { object: issues } = await cloudy008.generate(
        [
          {
            role: "user",
            content: `Here are all the available labels and milestones: ${JSON.stringify(inputData.getLabelsAndMilestones, null, 2)}`,
          },
          {
            role: "user",
            content: `Create GitHub issues from the conversation history: ${JSON.stringify(inputData.getConversationHistory.conversationHistory, null, 2)}`,
          },
        ],
        { output: issuesSchema },
      );

      return issues;
    },
  });

  const postIssues = createStep({
    id: "postIssues",
    description: "Create GitHub issues from the conversation history",
    inputSchema: issuesSchema,
    outputSchema: outputSchema,
    execute: async ({ inputData, runtimeContext }) => {
      function toQueryString(params: Record<string, string>) {
        return Object.entries(params)
          .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
          .join("&");
      }

      const summaryBlocks: KnownBlock[] = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📋 *Draft Summary*: Drafted ${inputData.issues.length} issue${inputData.issues.length === 1 ? "" : "s"}`,
          },
        },
      ];

      if (inputData.issues.length !== 0) {
        summaryBlocks.push({
          type: "divider",
        });
      }

      const emojisForIndex = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
      const getEmojiForIndex = (index: number) => emojisForIndex[index] || "🔢";

      const issueBlocks = inputData.issues.reduce<KnownBlock[]>((acc, issue, index, issues) => {
        const indexEmoji = getEmojiForIndex(index);

        const url = `https://github.com/${GH_OWNER}/${GH_REPO}/issues/new?${toQueryString({
          title: issue.title,
          body: issue.description,
          labels: issue.labels.join(","),
        })}`;

        acc.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${indexEmoji} *${issue.title}*`,
          },
        });

        acc.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: issue.description,
          },
        });

        // Add labels block if there are labels
        if (issue.labels.length > 0) {
          acc.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Labels:* ${issue.labels.map((label) => `\`${label}\``).join(", ")}`,
            },
          });
        }

        acc.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Create GitHub Issue" },
              url,
            },
          ],
        });

        if (index !== issues.length - 1) {
          acc.push({
            type: "divider",
          });
        }

        return acc;
      }, []);

      const blocks = [...summaryBlocks, ...issueBlocks];

      const channelId = runtimeContext.get("channelId") as string; // TODO: fixme...
      const threadOrMessageTs = runtimeContext.get("threadOrMessageTs") as string; // TODO: fixme...

      await slackTryJoin(
        () =>
          client.chat.postEphemeral({
            channel: channelId,
            thread_ts: threadOrMessageTs,
            text: "GitHub issue specs generated from the conversation:",
            blocks,
            icon_emoji: ":rocket:",
            user: user.id,
          }),
        client,
        channelId,
      );

      return { created: true };
    },
  });

  const doNotCreateIssues = createStep({
    id: "failStep",
    inputSchema: issuesSchema,
    outputSchema: outputSchema,
    execute: async ({ inputData, runtimeContext }) => {
      if (inputData.issues.length > 0) {
        throw new Error("Incorrectly executing doNotCreateIssues step");
      }

      const channelId = runtimeContext.get("channelId") as string; // TODO: fixme...
      const threadOrMessageTs = runtimeContext.get("threadOrMessageTs") as string; // TODO: fixme...

      await slackTryJoin(
        () =>
          client.chat.postEphemeral({
            channel: channelId,
            thread_ts: threadOrMessageTs,
            text: "Conversation does not contain enough information to create an issue.",
            icon_emoji: ":warning:",
            user: user.id,
          }),
        client,
        channelId,
      );

      return { created: false };
    },
  });

  const createGithubIssuesFromConversation = createWorkflow({
    id: "createGithubIssuesFromConversation",
    inputSchema: inputSchema,
    outputSchema: issuesSchema,
    steps: [getConversationHistory, specIssues, postIssues, doNotCreateIssues],
  })
    .parallel([getConversationHistory, getLabelsAndMilestones])
    .then(specIssues)
    .branch([
      [async ({ inputData }) => inputData.issues.length > 0, postIssues],
      [async ({ inputData }) => inputData.issues.length === 0, doNotCreateIssues],
    ])
    .commit();

  const mastra = new Mastra({
    agents: { cloudy008 },
    workflows: { createGithubIssuesFromConversation },
    logger: new PinoLogger({
      name: "createGithubIssuesFromConversation",
      level: "warn",
    }),
  });

  const workflowRun = mastra.getWorkflow("createGithubIssuesFromConversation").createRun();

  const slackRuntimeContext = new RuntimeContext<SlackRuntimeContext>();
  slackRuntimeContext.set("slackClient", client);

  return workflowRun.start({
    inputData: {
      channelId,
      threadOrMessageTs,
      gh_owner: GH_OWNER,
      gh_repo: GH_REPO,
    },
    runtimeContext: slackRuntimeContext,
  });
};
