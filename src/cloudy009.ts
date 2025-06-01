import { openai } from "@ai-sdk/openai";
import { Agent, createStep, createWorkflow, Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";
import type { MessageShortcut } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { z } from "zod";
import { embedIssue } from "./ai/embed_issue.js";
import { conversationHistorySchema, type SlackRuntimeContext } from "./ai/steps/getConversationHistory.js";
import { getLabelsAndMilestones, labelsAndMilestonesSchema } from "./ai/steps/getToolsAndMilestones.js";
import { GH_OWNER, GH_REPO } from "./config.js";
import { searchGithubIssuesByEmbeddings } from "./db/db.js";
import { RuntimeContext } from "@mastra/core/runtime-context";

export const findGithubIssues = ({
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
  const cloudy009 = new Agent({
    model: openai("gpt-4o-mini"),
    name: "Cloudy009",
    instructions: `You are Cloudy009, a helpful assistant that searches for issues in GitHub based on the conversation history.

  You help Lightdash support engineers by searching for issues.

  Your job:
  - Read the entire Slack thread.
  - Search for existing issues in GitHub based on the thread messages.
  - Make a search query for the issues based on the thread messages.
  - Additional instructions:
    - Use code blocks and bullet point lists to make it more readable if needed.
    - ONLY USE SLACK FLAVOR OF MARKDOWN.

  Make sure the search queries are clear and actionable.
  `,
  });

  const inputSchema = z.object({
    channelId: z.string().describe("The channel ID"),
    threadOrMessageTs: z.string().describe("The thread or message timestamp"),
    gh_owner: z.string().describe("The GitHub owner"),
    gh_repo: z.string().describe("The GitHub repository"),
  });

  const searchQuerySchema = z.object({
    searchQueries: z.object({
      title: z.string().describe("The title of the issue that should be searched for"),
      description: z.string().describe("The description of the issue that should be searched for"),
      labels: z.array(z.string()).describe("The labels of the issue that should be searched for"),
      milestone: z.string().describe("The milestone of the issue that should be searched for"),
    }),
  });

  const issuesSchema = z.object({
    issues: z.array(
      z.object({
        title: z.string().describe("The title of the issue"),
        description: z.string().nullable().describe("The description of the issue"),
        url: z.string().describe("The URL of the issue"),
      }),
    ),
  });

  const outputSchema = z.object({
    searched: z.boolean().describe("Whether the issues were searched for"),
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

  const generateSearchQueries = createStep({
    id: "generateSearchQueries",
    description: "Generate search queries for the issues",
    inputSchema: z.object({
      getLabelsAndMilestones: labelsAndMilestonesSchema,
      getConversationHistory: conversationHistorySchema,
    }),
    outputSchema: searchQuerySchema,
    execute: async ({ inputData }) => {
      const { object: issues } = await cloudy009.generate(
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
        { output: searchQuerySchema },
      );

      return issues;
    },
  });

  const searchForIssues = createStep({
    id: "searchForIssues",
    description: "Search for issues in GitHub",
    inputSchema: searchQuerySchema,
    outputSchema: issuesSchema,
    execute: async ({ inputData }) => {
      const embeddings = await embedIssue({
        title: inputData.searchQueries.title,
        description: inputData.searchQueries.description,
        labels: inputData.searchQueries.labels,
        milestone: inputData.searchQueries.milestone,
      });

      const issues = await searchGithubIssuesByEmbeddings(GH_OWNER, GH_REPO, "issue", embeddings);

      const mappedIssues = issues.map((issue) => ({
        title: issue.title,
        description: issue.description,
        url: issue.issue_url,
      }));

      return { issues: mappedIssues };
    },
  });

  const postFoundIssues = createStep({
    id: "postFoundIssues",
    description: "Post the found issues to the channel",
    inputSchema: issuesSchema,
    outputSchema: outputSchema,
    execute: async ({ inputData, runtimeContext }) => {
      const blocks = inputData.issues.reduce<KnownBlock[]>((acc, issue, index, allIssues) => {
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
                text: { type: "plain_text", text: "Open in GitHub" },
                url: issue.url,
              },
            ],
          },
        );

        if (allIssues.length - 1 !== index) {
          acc.push({
            type: "divider",
          });
        }

        return acc;
      }, []);

      const channelId = runtimeContext.get("channelId");
      const threadOrMessageTs = runtimeContext.get("threadOrMessageTs");

      await client.chat.postEphemeral({
        channel: channelId as string,
        thread_ts: threadOrMessageTs as string,
        text: "GitHub issue specs generated from the conversation:",
        blocks,
        icon_emoji: ":female-detective:",
        user: user.id,
      });

      return { searched: true };
    },
  });

  const doNotSearchForIssues = createStep({
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
        text: "Conversation does not contain enough information to find issues.",
        icon_emoji: ":warning:",
      });

      return { searched: false };
    },
  });

  const createGithubIssuesFromConversation = createWorkflow({
    id: "createGithubIssuesFromConversation",
    inputSchema: inputSchema,
    outputSchema: issuesSchema,
    steps: [
      getConversationHistory,
      getLabelsAndMilestones,
      generateSearchQueries,
      searchForIssues,
      postFoundIssues,
      doNotSearchForIssues,
    ],
  })
    .parallel([getConversationHistory, getLabelsAndMilestones])
    .then(generateSearchQueries)
    .then(searchForIssues)
    .branch([
      [async ({ inputData }) => inputData.issues.length > 0, postFoundIssues],
      [async ({ inputData }) => inputData.issues.length === 0, doNotSearchForIssues],
    ])
    .commit();

  const mastra = new Mastra({
    agents: { cloudy009 },
    workflows: { createGithubIssuesFromConversation },
    logger: new PinoLogger({
      name: "createGithubIssuesFromConversation",
      level: "debug",
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
