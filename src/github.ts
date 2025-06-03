import type { Endpoints } from "@octokit/types";
import type { Webhooks } from "@octokit/webhooks";
import { remark } from "remark";
import strip from "strip-markdown";
import { embedIssue } from "./ai/embed_issue.js";
import { octokitClient } from "./clients/github.js";
import { slackApp } from "./clients/slack.js";
import { GH_OWNER, GH_REPO } from "./config.js";
import { getIssueThreadsFromIssue, knex, setIssueIsClosed, updateGithubIssueStatus } from "./db/db.js";
import { getLastComment, renderIssueRef } from "./github_utils.js";

const initGithubWebhooks = (githubWebhooks: Webhooks) => {
  githubWebhooks.on("issues.assigned", async ({ payload }) => {
    const issueUrl = payload.issue.html_url;
    const slack_threads = await getIssueThreadsFromIssue(issueUrl);
    const assignees = (payload.issue.assignees || [])
      .filter((a) => !!a)
      .map((a) => `<${a.html_url}|${a.login}>`)
      .join(", ");
    const text = `🥳 ${assignees} started work on ${renderIssueRef(issueUrl)}!`;
    for await (const slack_thread of slack_threads) {
      await slackApp.client.chat.postMessage({
        text,
        token: slack_thread.bot_token,
        channel: slack_thread.channel_id,
        thread_ts: slack_thread.slack_thread_ts,
        unfurl_links: false,
        unfurl_media: false,
      });
    }
  });

  githubWebhooks.on("issues.closed", async ({ payload }) => {
    const issueUrl = payload.issue.html_url;
    await setIssueIsClosed(issueUrl, true);
    await updateGithubIssueStatus({
      owner: GH_OWNER,
      repo: GH_REPO,
      status: "closed",
      issue_id: payload.issue.number,
    });

    let message = `Issue ${renderIssueRef(issueUrl)} was closed`; // default message
    if (payload.issue.state_reason === "completed") {
      message = `✅ We've fixed ${renderIssueRef(issueUrl)}: _${
        payload.issue.title
      }_\n\nLightdash Cloud users will automatically get the fix once your instance updates (All instances update at 01:00 PST [10:00 CET] daily). Self-hosted users should update to the latest version to get the fix 🎉`;
    } else if (payload.issue.state_reason === "not_planned") {
      const lastMessage = (await getLastComment(octokitClient, issueUrl)) || "No information provided";
      message = `🗑 Issue ${renderIssueRef(
        issueUrl,
      )} is no longer planned to be fixed.\n> ${lastMessage}\nCheck out the linked issue for more information.`;
    }
    const slack_threads = await getIssueThreadsFromIssue(issueUrl);
    for await (const slack_thread of slack_threads) {
      await slackApp.client.chat.postMessage({
        text: message,
        token: slack_thread.bot_token,
        channel: slack_thread.channel_id,
        thread_ts: slack_thread.slack_thread_ts,
        unfurl_links: false,
        unfurl_media: false,
      });
    }
  });

  githubWebhooks.on("issues.reopened", async ({ payload }) => {
    const issueUrl = payload.issue.html_url;
    await setIssueIsClosed(issueUrl, false);
    await updateGithubIssueStatus({
      owner: GH_OWNER,
      repo: GH_REPO,
      status: "open",
      issue_id: payload.issue.number,
    });
    const slack_threads = await getIssueThreadsFromIssue(issueUrl);
    for await (const slack_thread of slack_threads) {
      await slackApp.client.chat.postMessage({
        text: `🔧 We've reopened this issue: ${renderIssueRef(issueUrl)}: _${
          payload.issue.title
        }_\n\nI'll notify everybody here as soon as there's another update.`,
        token: slack_thread.bot_token,
        channel: slack_thread.channel_id,
        thread_ts: slack_thread.slack_thread_ts,
        unfurl_links: false,
        unfurl_media: false,
      });
    }
  });

  githubWebhooks.on("issues.opened", async ({ payload }) => {
    const issue = await octokitClient.rest.issues.get({
      owner: GH_OWNER,
      repo: GH_REPO,
      issue_number: payload.issue.number,
    });

    if (issue.data.state === "closed") {
      console.info(`Issue ${issue.data.number} is closed`);
      return;
    }

    await createGithubIssue({
      owner: GH_OWNER,
      repo: GH_REPO,
      issue: issue.data,
    });
  });
};

type Issue = Pick<
  Endpoints["GET /repos/{owner}/{repo}/issues"]["response"]["data"][number],
  | "title"
  | "body"
  | "labels"
  | "milestone"
  | "body_text"
  | "body_html"
  | "html_url"
  | "number"
  | "state"
  | "pull_request"
>;

export const createGithubIssue = async ({ owner, repo, issue }: { owner: string; repo: string; issue: Issue }) => {
  const body = issue.body ?? issue.body_text ?? issue.body_html ?? null;
  const labels = issue.labels.map((l) => (typeof l === "string" ? l : l.name)).filter((l) => l !== undefined);
  const milestone = issue.milestone?.title ?? null;

  const strippedBody = body
    ? (
        await remark()
          .use(strip, { remove: ["html", "image", "imageReference"] })
          .process(body)
      ).toString()
    : null;

  const embeddings = await embedIssue({
    title: issue.title,
    description: strippedBody,
    labels: labels,
    milestone: issue.milestone?.title ?? null,
  });

  await knex("github_issues")
    .insert({
      title: issue.title,
      description: strippedBody,

      owner: owner,
      repo: repo,

      labels,
      milestone,
      embeddings,

      issue_url: issue.html_url,
      issue_id: issue.number,

      type: issue.pull_request ? "pr" : "issue",
      status: issue.state,
    })
    .onConflict(["owner", "repo", "issue_id"])
    .merge();
};

export default initGithubWebhooks;
