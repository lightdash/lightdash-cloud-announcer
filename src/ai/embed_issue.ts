import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import type { GithubIssue } from "knex/types/tables.js";

export const embedIssue = async (issue: Pick<GithubIssue, "title" | "description" | "labels" | "milestone">) => {
  const embedding = await embed({
    model: openai.embedding("text-embedding-3-large"),
    value: JSON.stringify(
      {
        title: issue.title,
        labels: issue.labels,
        milestone: issue.milestone,
        description: issue.description,
      },
      null,
      2,
    ),
  });

  const embeddingString = `[${embedding.embedding.join(",")}]`;
  return embeddingString;
};
