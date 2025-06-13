/// <reference path="./db.d.ts" />

import type { Installation, InstallationQuery } from "@slack/bolt";
import Knex from "knex";
import type { GithubIssue, GithubIssueSlackThread } from "knex/types/tables.js";
import { ENV, slackAuthorizedTeams } from "../config.js";
import { getTeamIdFromInstallation, getTeamIdFromInstallationQuery } from "../slack_utils.js";
import knexfile from "./knexfile.js";

const knexConfig = knexfile[ENV];
export const knex = Knex(knexConfig);

export const totalOpenIssueCountInChannel = async (channelId: string): Promise<number> => {
  const res = await knex("github_issue_slack_threads")
    .countDistinct({ count: "github_issue_url" })
    .where("channel_id", channelId)
    .andWhereRaw("is_closed is false");

  return Number(res[0]?.count ?? 0);
};

export const allOpenIssueUrlsInChannel = async (channelId: string): Promise<string[]> => {
  const openIssues = await knex("github_issue_slack_threads")
    .select("github_issue_url")
    .distinctOn("github_issue_url")
    .where("channel_id", channelId)
    .andWhere("is_closed", false);

  return openIssues.map((issue) => issue.github_issue_url);
};

export const setIssueIsClosed = async (githubIssueUrl: string, isClosed: boolean): Promise<void> => {
  await knex("github_issue_slack_threads").where("github_issue_url", githubIssueUrl).update({ is_closed: isClosed });
};

export const createGithubIssueSlackThread = async (githubIssueSlackThread: GithubIssueSlackThread) => {
  await knex("github_issue_slack_threads")
    .insert(githubIssueSlackThread)
    .onConflict(["github_issue_url", "slack_team_id", "channel_id", "slack_thread_ts"])
    .merge();
};

export const getIssueThreadsFromIssue = async (githubIssueUrl: string) => {
  const res = await knex("github_issue_slack_threads")
    .select<
      {
        github_issue_url: string;
        channel_id: string;
        slack_thread_ts: string;
        bot_token: string;
      }[]
    >(
      "github_issue_slack_threads.github_issue_url",
      "github_issue_slack_threads.channel_id",
      "github_issue_slack_threads.slack_thread_ts",
      knex.raw(`auths.installation->'bot'->'token' as bot_token`),
    )
    .innerJoin("slack_auth_tokens as auths", "github_issue_slack_threads.slack_team_id", "auths.slack_team_id")
    .where("github_issue_slack_threads.github_issue_url", githubIssueUrl);

  return res;
};

export const getSlackBotToken = async (slackTeamId: string): Promise<string> => {
  const row = await knex("slack_auth_tokens")
    .first<{
      bot_token: string;
    }>(knex.raw("installation->'bot'->>'token' as bot_token"))
    .where("slack_team_id", slackTeamId);

  if (row === undefined) {
    throw new Error(`Could not find a slack bot token for team id ${slackTeamId}`);
  }

  return row.bot_token;
};

export const countAllOpenIssues = async () => {
  const res = await knex("github_issue_slack_threads")
    .select<
      {
        github_issue_url: string;
        count: number;
      }[]
    >("github_issue_url", knex.raw("COUNT(*) as count"))
    .where((b) => b.where("is_closed", false).orWhereNull("is_closed"))
    .groupBy("github_issue_url")
    .orderBy("count", "desc");

  return res;
};

export const countAllOpenIssuesInChannel = async (channelId: string) => {
  const res = await knex("github_issue_slack_threads")
    .select<
      {
        github_issue_url: string;
        count: number;
      }[]
    >("github_issue_url", knex.raw("COUNT(*) as count"))
    .where("channel_id", channelId)
    .where((b) => b.where("is_closed", false).orWhereNull("is_closed"))
    .groupBy("github_issue_url")
    .orderBy("count", "desc");

  return res;
};

export const storeInstallation = async <T extends boolean, V extends "v1" | "v2">(
  installation: Installation<V, T>,
): Promise<void> => {
  const teamId = getTeamIdFromInstallation(installation);
  if (!slackAuthorizedTeams.includes(teamId)) {
    throw new Error("Not authorized to install Cloudy in this workspace");
  }

  await knex("slack_auth_tokens")
    .insert({
      slack_team_id: teamId,
      installation,
    })
    .onConflict("slack_team_id")
    .ignore();
};

export const fetchInstallation = async <T extends boolean>(installQuery: InstallationQuery<T>) => {
  const teamId = getTeamIdFromInstallationQuery(installQuery);

  const [row] = await knex("slack_auth_tokens").select("*").where("slack_team_id", teamId);
  if (row === undefined) {
    throw new Error(`Could not find an installation for team id ${teamId}`);
  }
  return row.installation;
};

export const deleteInstallation = async <T extends boolean>(installQuery: InstallationQuery<T>) => {
  const teamId = getTeamIdFromInstallationQuery(installQuery);
  await knex("slack_auth_tokens").delete().where("slack_team_id", teamId);
};

export const getCurrentFirstResponder = async (
  slackTeamId: string,
): Promise<{ slack_user_id: string; started_at: Date } | null> => {
  const row = await knex("first_responders")
    .select("slack_user_id", "started_at")
    .where("slack_team_id", slackTeamId)
    .orderBy("started_at", "desc")
    .first();
  return row || null;
};

export const setFirstResponder = async (slackTeamId: string, slackUserId: string): Promise<void> => {
  await knex("first_responders").insert({
    slack_team_id: slackTeamId,
    slack_user_id: slackUserId,
  });
};

export const getFirstResponderStats = async (
  slackTeamId: string,
): Promise<{ slack_user_id: string; total_hours: number }[]> => {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const rows = await knex("first_responders")
    .select("slack_user_id", "started_at")
    .where("slack_team_id", slackTeamId)
    .where("started_at", ">=", sevenDaysAgo)
    .orderBy("started_at");

  const userStats: Record<string, number> = {};

  // Calculate time spent as first responder for each shift
  for (const [i, currentRow] of rows.entries()) {
    const nextRow = i < rows.length - 1 ? rows[i + 1] : null;

    const userId = currentRow.slack_user_id;
    const startTime = new Date(currentRow.started_at).getTime();
    const endTime = nextRow ? new Date(nextRow.started_at).getTime() : Date.now();

    const hoursSpent = (endTime - startTime) / (1000 * 60 * 60);

    userStats[userId] = (userStats[userId] || 0) + hoursSpent;
  }

  // Convert to array and sort by hours (descending)
  return Object.entries(userStats)
    .map(([slack_user_id, total_hours]) => ({
      slack_user_id,
      total_hours: Math.round(total_hours * 10) / 10, // Round to 1 decimal place
    }))
    .sort((a, b) => b.total_hours - a.total_hours);
};

export const searchGithubIssuesByEmbeddings = async (
  owner: string,
  repo: string,
  type: "issue" | "pr",
  embeddings: string[],
  limit = 3,
  threshold = 0.66,
) => {
  return knex
    .select<
      {
        title: string;
        description: string;
        issue_url: string;
        status: string | null;
        milestone: string | null;
        labels: string[] | null;
        rank: number;
      }[]
    >("*")
    .from(function () {
      // @ts-ignore does not like function and this.select...
      // Compute the best (highest) similarity rank across all embeddings for each issue
      // embeddings is an array of serialized embedding strings
      // We'll use a VALUES clause to unnest the embeddings and compute the max rank
      this.select(
        "title",
        "description",
        "issue_url",
        "status",
        "milestone",
        "labels",
        knex.raw(
          `
          (
            SELECT MAX(1 - (github_issues.embeddings <=> ve.embedding::vector))
            FROM (VALUES ${embeddings.map(() => "(?)").join(", ")}) AS ve(embedding)
          ) AS rank
        `,
          embeddings,
        ),
      )
        .from("github_issues")
        .where({ owner, repo, type })
        .as("ranked_issues");
    })
    .where("rank", ">", threshold)
    .orderBy("rank", "desc")
    .limit(limit);
};

export const updateGithubIssueStatus = async (
  issueUpdate: Pick<GithubIssue, "owner" | "repo" | "status" | "issue_id">,
) => {
  await knex("github_issues")
    .where({ owner: issueUpdate.owner, repo: issueUpdate.repo, issue_id: issueUpdate.issue_id })
    .update({ status: issueUpdate.status });
};
