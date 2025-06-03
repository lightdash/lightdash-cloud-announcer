import { createStep } from "@mastra/core";
import { z } from "zod";
import type { slackApp } from "../../clients/slack.js";
import type { RuntimeContext } from "@mastra/core/runtime-context";

export type SlackRuntimeContext = {
  slackClient: typeof slackApp.client;
};

const getConversationHistoryInputSchema = z.object({
  channelId: z.string().describe("The Slack channel ID"),
  threadOrMessageTs: z.string().describe("The Slack thread or message timestamp"),
  // to satisfy type checking
  gh_owner: z.string().describe("The GitHub owner"),
  gh_repo: z.string().describe("The GitHub repository"),
});

export const conversationHistorySchema = z.object({
  conversationHistory: z
    .array(
      z.object({
        author: z.string().nullable().describe("The author of the message"),
        message: z.string().describe("The message"),
      }),
    )
    .describe("The conversation history"),
});

export const getConversationHistory = createStep({
  id: "getConversationHistory",
  inputSchema: getConversationHistoryInputSchema,
  outputSchema: conversationHistorySchema,
  execute: async ({ inputData, runtimeContext }) => {
    const client = (runtimeContext as RuntimeContext<SlackRuntimeContext>).get("slackClient");

    const allMessages = await client.conversations.replies({
      channel: inputData.channelId,
      ts: inputData.threadOrMessageTs,
    });

    runtimeContext.set("channelId", inputData.channelId);
    runtimeContext.set("threadOrMessageTs", inputData.threadOrMessageTs);

    const messagesWithAuthor = await Promise.all(
      (allMessages.messages ?? [])?.map(async (message) => {
        const userInfo = message.user ? await client.users.info({ user: message.user }) : null;

        return {
          author: userInfo?.user?.name ?? null,
          message: message.text ?? "",
        };
      }),
    );

    return {
      conversationHistory: messagesWithAuthor,
    };
  },
});
