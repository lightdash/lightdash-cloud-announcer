import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { Agent, createStep, createWorkflow, Mastra } from "@mastra/core";
import { PinoLogger } from "@mastra/loggers";
import type { KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import type { MessageShortcut } from "@slack/bolt";
import { knex } from "./knexfile.js";

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
  const owner = "lightdash";
  const repo = "lightdash";

  const cloudy009 = new Agent({
    model: openai("gpt-4o-mini"),
    name: "Cloudy008",
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
    inputSchema: conversationHistorySchema,
    outputSchema: searchQuerySchema,
    execute: async ({ inputData }) => {
      const { object: issues } = await cloudy009.generate(
        [
          {
            role: "user",
            content: `Create GitHub issues from the conversation history: ${JSON.stringify(inputData.conversationHistory, null, 2)}`,
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
      const embeddings = `[${(
        await embed({
          model: openai.embedding("text-embedding-3-small"),
          value: JSON.stringify({
            title: inputData.searchQueries.title,
            labels: inputData.searchQueries.labels,
            milestone: inputData.searchQueries.milestone,
            description: inputData.searchQueries.description,
          }),
        })
      ).embedding.join(",")}]`;

      const issues = await knex
        .select("*")
        .from(function () {
          // @ts-expect-error
          this.select("title", "description", "issue_url", {
            rank: knex.raw(`1 - (github_issues.embeddings <=> ?)`, [embeddings]),
          })
            .from("github_issues")
            .where({ owner, repo })
            .as("ranked_issues");
        })
        .where("rank", ">", 0.66)
        .orderBy("rank", "desc")
        .limit(3);

      console.dir(issues, { depth: null });

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
      const blocks = inputData.issues.reduce<KnownBlock[]>((acc, issue) => {
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
    steps: [getConversationHistory, generateSearchQueries, searchForIssues, postFoundIssues, doNotSearchForIssues],
  })
    .then(getConversationHistory)
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

  return workflowRun.start({
    inputData: {
      channelId,
      threadOrMessageTs,
    },
  });
};
