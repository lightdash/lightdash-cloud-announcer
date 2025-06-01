import { createStep } from "@mastra/core";
import { z } from "zod";
import { octokitClient } from "../../clients/github.js";

const getLabelsAndMilestonesInputSchema = z.object({
  gh_owner: z.string().describe("The GitHub owner"),
  gh_repo: z.string().describe("The GitHub repository"),
  // to satisfy type checking
  channelId: z.string().describe("The Slack channel ID"),
  threadOrMessageTs: z.string().describe("The Slack thread or message timestamp"),
});

export const labelsAndMilestonesSchema = z.object({
  labels: z.array(z.string()),
  milestones: z.array(z.string()),
});

export const getLabelsAndMilestones = createStep({
  id: "getLabelsAndMilestones",
  description: "Get labels and milestones from GitHub",
  inputSchema: getLabelsAndMilestonesInputSchema,
  outputSchema: labelsAndMilestonesSchema,
  execute: async ({ inputData: { gh_owner, gh_repo } }) => {
    const labels = await octokitClient.rest.issues.listLabelsForRepo({
      owner: gh_owner,
      repo: gh_repo,
    });

    const milestones = await octokitClient.rest.issues.listMilestones({
      owner: gh_owner,
      repo: gh_repo,
    });

    return {
      labels: labels.data.map((label) => label.name),
      milestones: milestones.data.map((milestone) => milestone.title),
    };
  },
});
