import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core";
import { z } from "zod";

const Cloudy007 = new Agent({
  model: openai("gpt-4o-mini"),
  name: "Cloudy007",
  instructions: `You are Cloudy007, a helpful assistant that summarizes Slack conversations.

You help Lightdash support engineers by summarizing Slack threads quickly and clearly.

Your job is to:
- Summarize the whole Slack thread into a concise, clear Slack-formatted message (no markdown).
- Say if the conversation is resolved or still needs attention.
- Rate the issue's severity: low, medium, or high.
- Detect how frustrated or angry people sound: none, mild, or strong.

Make the summary focused, actionable, and helpful—don't just repeat the text back. Thank you <3
`,
});

const schema = z.object({
  summary: z.string().describe("Summarized conversation in Slack format"),
  resolved: z.boolean().describe("Is the conversation resolved?"),
  severity: z.enum(["low", "medium", "high"]).describe("Issue severity level"),
  angerLevel: z
    .enum(["none", "mild", "strong"])
    .describe("Level of anger in the conversation"),
});

export const summarizeConversation = async (text: string) => {
  const result = await Cloudy007.generate([{ role: "user", content: text }], {
    output: schema,
  });

  return result;
};
