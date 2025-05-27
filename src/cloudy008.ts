import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { Agent, createStep, createWorkflow, Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";
import type { KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { MessageShortcut } from "@slack/bolt";

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
    model: openai("gpt-4o-mini"),
    name: "Cloudy008",
    instructions: `You are Cloudy007, a helpful assistant that creates clear GitHub issue specs from Slack conversations.

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
  - Additional instructions:
    - Use code blocks and bullet point lists to make it more readable if needed.

  Make sure the issue spec is clear and actionable.
  `,
  });

  const inputSchema = z.object({
    channelId: z.string().describe("The channel ID"),
    threadOrMessageTs: z.string().describe("The thread or message timestamp"),
  });

  const conversationHistorySchema = z.object({
    conversationHistory: z
      .array(
        z.object({
          author: z.string().describe("The author of the message"),
          message: z.string().describe("The message"),
        }),
      )
      .describe("The conversation history"),
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

  const getConversationHistory = createStep({
    id: "getConversationHistory",
    inputSchema: inputSchema,
    outputSchema: conversationHistorySchema,
    execute: async ({ inputData, runtimeContext }) => {
      const allMessages = await client.conversations.replies({
        channel: inputData.channelId,
        ts: inputData.threadOrMessageTs,
      });

      runtimeContext.set("channelId", inputData.channelId);
      runtimeContext.set("threadOrMessageTs", inputData.threadOrMessageTs);

      const messagesWithAuthor: {
        author: string;
        message: string;
      }[] =
        allMessages.messages?.map((message) => ({
          author: message.user ?? "",
          message: message.text ?? "",
        })) ?? [];

      return {
        conversationHistory: messagesWithAuthor,
      };
    },
  });

  const specIssues = createStep({
    id: "specIssues",
    description: "Create GitHub issues from the conversation history",
    inputSchema: conversationHistorySchema,
    outputSchema: issuesSchema,
    execute: async ({ inputData }) => {
      const { object: issues } = await cloudy008.generate(
        [
          {
            role: "user",
            content: `Create GitHub issues from the conversation history: ${JSON.stringify(inputData.conversationHistory, null, 2)}`,
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

      const blocks = inputData.issues.reduce<KnownBlock[]>((acc, issue) => {
        const url = `https://github.com/lightdash/lightdash/issues/new?${toQueryString({
          title: issue.title,
          body: issue.description,
          labels: issue.labels.join(","),
        })}`;

        acc.push(
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${issue.title}*\n\n${issue.description}`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Create GitHub Issue" },
                url,
              },
            ],
          },
          {
            type: "divider",
          },
        );

        return acc;
      }, []);

      const channelId = runtimeContext.get("channelId");
      const threadOrMessageTs = runtimeContext.get("threadOrMessageTs");

      await client.chat.postEphemeral({
        channel: channelId as string,
        thread_ts: threadOrMessageTs as string,
        text: "GitHub issue specs generated from the conversation:",
        blocks,
        icon_emoji: ":rocket:",
        as_user: false,
        user: user.id,
      });

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

      const channelId = runtimeContext.get("channelId");
      const threadOrMessageTs = runtimeContext.get("threadOrMessageTs");

      await client.chat.postMessage({
        channel: channelId as string,
        thread_ts: threadOrMessageTs as string, // TODO: fixme...
        text: "Conversation does not contain enough information to create an issue.",
        icon_emoji: ":warning:",
      });

      return { created: false };
    },
  });

  const createGithubIssuesFromConversation = createWorkflow({
    id: "createGithubIssuesFromConversation",
    inputSchema: inputSchema,
    outputSchema: issuesSchema,
    steps: [getConversationHistory, specIssues, postIssues, doNotCreateIssues],
  })
    .then(getConversationHistory)
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
      level: "debug",
    }),
  });

  const workflowRun = mastra.getWorkflow("createGithubIssuesFromConversation").createRun();

  return workflowRun.start({
    inputData: {
      channelId,
      threadOrMessageTs,
    },
  });
};
