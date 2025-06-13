import { openai } from "@ai-sdk/openai";
import type { WebClient } from "@slack/web-api";
import { Agent, createStep, createWorkflow, Mastra } from "@mastra/core";
import { z } from "zod";
import type { MessageShortcut } from "@slack/bolt";
import { PinoLogger } from "@mastra/loggers";
import {
  conversationHistorySchema,
  getConversationHistory,
  type SlackRuntimeContext,
} from "./ai/steps/getConversationHistory.js";
import { RuntimeContext } from "@mastra/core/runtime-context";
import { slackTryJoin } from "./slack_utils.js";

const cloudy007 = new Agent({
  model: openai("gpt-4.1", { structuredOutputs: true }),
  name: "cloudy007",
  instructions: `You are cloudy007, a helpful assistant that summarizes Slack conversations.

You help Lightdash support engineers by summarizing Slack threads quickly and clearly.

Your job is to:
- Summarize the whole Slack thread into a concise, clear Slack-formatted message (no markdown).
- Say if the conversation is resolved or still needs attention.
- Rate the issue's severity: low, medium, or high.
- Detect how frustrated or angry people sound: none, mild, or strong.

Make the summary focused, actionable, and helpful—don't just repeat the text back. Thank you <3
`,
});

export const summarizeConversation = ({
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
  const inputSchema = z.object({
    channelId: z.string().describe("The channel ID"),
    threadOrMessageTs: z.string().describe("The thread or message timestamp"),
  });

  const postLoadingMessageStep = createStep({
    id: "postLoadingMessage",
    description: "Post a loading message in Slack",
    inputSchema: inputSchema,
    outputSchema: inputSchema,
    execute: async ({ inputData }) => {
      await slackTryJoin(
        () =>
          client.chat.postEphemeral({
            channel: inputData.channelId,
            thread_ts: inputData.threadOrMessageTs,
            icon_emoji: ":clipboard:",
            text: "Summarizing conversation...",
            user: user.id,
          }),
        client,
        inputData.channelId,
      );

      return inputData;
    },
  });

  const conversationSummarySchema = z.object({
    summary: z.string().describe("Summarized conversation in Slack format"),
    resolved: z.boolean().describe("Is the conversation resolved?"),
    severity: z.enum(["low", "medium", "high"]).describe("Issue severity level"),
    frustrationLevel: z.enum(["calm", "mild", "strong"]).describe("Level of anger in the conversation"),
  });

  const summarizeConversationStep = createStep({
    id: "summarizeConversation",
    description: "Search for issues in GitHub",
    inputSchema: conversationHistorySchema,
    outputSchema: conversationSummarySchema,
    execute: async ({ inputData }) => {
      const conversationTranscript = inputData.conversationHistory
        .map(
          (message) => `
Author: ${message.author ?? "unknown"}
Message: ${message.message}
`,
        )
        .join("\n\n---------\n\n");

      const { object: summary } = await cloudy007.generate(
        [
          { role: "user", content: conversationTranscript },
          { role: "user", content: "Summarize the conversation" },
        ],
        {
          output: conversationSummarySchema,
        },
      );

      return summary;
    },
  });

  const postInSlackStep = createStep({
    id: "postInSlack",
    description: "Post summary in Slack",
    inputSchema: conversationSummarySchema,
    outputSchema: z.object({}).describe("No output"),
    execute: async ({ inputData }) => {
      const severityEmojis = {
        low: "🟢 low",
        medium: "🟠 medium",
        high: "🔴 high",
      } as const;
      const frustrationEmojis = {
        calm: "😌 calm",
        mild: "😠 mild",
        strong: "😡 strong",
      } as const;

      await slackTryJoin(
        async () => {
          client.chat.postEphemeral({
            channel: channelId,
            thread_ts: threadOrMessageTs,
            icon_emoji: ":clipboard:",
            text: inputData.summary,
            user: user.id,
            blocks: [
              {
                type: "section",
                text: { type: "mrkdwn", text: inputData.summary },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `*Resolved:* ${inputData.resolved ? "✅ Yes" : "❌ No"}`,
                  },
                  {
                    type: "mrkdwn",
                    text: `*Severity:* ${severityEmojis[inputData.severity]}`,
                  },
                  {
                    type: "mrkdwn",
                    text: `*Frustration:* ${frustrationEmojis[inputData.frustrationLevel]}`,
                  },
                ],
              },
            ],
          });
        },
        client,
        channelId,
      );

      return {};
    },
  });

  const summarizeConversationWorkflow = createWorkflow({
    id: "summarizeConversationWorkflow",
    inputSchema: inputSchema,
    outputSchema: conversationSummarySchema,
    steps: [postLoadingMessageStep, getConversationHistory, summarizeConversationStep, postInSlackStep],
  })
    .then(postLoadingMessageStep)
    .then(getConversationHistory)
    .then(summarizeConversationStep)
    .then(postInSlackStep)
    .commit();

  const slackRuntimeContext = new RuntimeContext<SlackRuntimeContext>();
  slackRuntimeContext.set("slackClient", client);

  const mastra = new Mastra({
    agents: { cloudy007 },
    workflows: { summarizeConversationWorkflow },
    logger: new PinoLogger({
      name: "summarizeConversation",
      level: "warn",
    }),
  });

  const workflowRun = mastra.getWorkflow("summarizeConversationWorkflow").createRun();

  return workflowRun.start({
    inputData: {
      channelId,
      threadOrMessageTs,
    },
    runtimeContext: slackRuntimeContext,
  });
};
