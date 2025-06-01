import { embed } from "ai";
import type { Webhooks } from "@octokit/webhooks";
import { octokitClient, slackApp } from "./clients.js";
import { getIssueThreadsFromIssue, setIssueIsClosed } from "./db/db.js";
import { getLastComment, renderIssueRef } from "./github_utils.js";
import { knex } from "./knexfile.js";
import { openai } from "@ai-sdk/openai";

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

    let message = `Issue ${renderIssueRef(issueUrl)} was closed`; // default message
    if (payload.issue.state_reason === "completed") {
      message = `✅ We've fixed ${renderIssueRef(issueUrl)}: _${
        payload.issue.title
      }_\n\nLightdash Cloud users will automatically get the fix once your instance updates (All instances update at 01:00 PST [10:00 CET] daily). Self-hosted users should update to the latest version to get the fix 🎉`;
    } else if (payload.issue.state_reason === "not_planned") {
      const lastMessage =
        (await getLastComment(octokitClient, issueUrl)) ||
        "No information provided";
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
};

export const syncGithubIssues = async ({ owner, repo }: { owner: string; repo: string }) => {
  const issues = await octokitClient.paginate("GET /repos/{owner}/{repo}/issues", {
    owner,
    repo,
    sort: "created",
    direction: "desc",
    state: "all",
    per_page: 100,
    // 3 month ago
    since: new Date(Date.now() - 3 * 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  for (const issue of issues.filter((i) => i.pull_request === undefined)) {
    const body = issue.body ?? issue.body_text ?? issue.body_html ?? null;

    await knex("github_issues")
      .insert({
        owner: owner,
        repo: repo,
        issue_url: issue.html_url,
        issue_id: issue.number,
        type: "issue",
        title: issue.title,
        description: issue.body ?? issue.body_text ?? issue.body_html ?? null,
        labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name)).filter((l) => l !== undefined),
        milestone: issue.milestone?.title ?? null,
        status: issue.state,
        embeddings: `[${(
          await embed({
            model: openai.embedding("text-embedding-3-small"),
            value: JSON.stringify({
              title: issue.title,
              labels: issue.labels.map((l) => (typeof l === "string" ? l : l.name)).filter((l) => l !== undefined),
              milestone: issue.milestone?.title ?? null,
              description: body,
            }),
          })
        ).embedding.join(",")}]`,
      })
      .onConflict(["owner", "repo", "issue_id"])
      .merge();
  }
};

export default initGithubWebhooks;
