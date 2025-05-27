import * as Sentry from "@sentry/node";
import type { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import minimist from "minimist";
import type { RequestError } from "octokit";
import { parseArgsStringToArgv } from "string-argv";
import { octokitClient } from "./clients.js";
import {
  allOpenIssueUrlsInChannel,
  countAllOpenIssues,
  countAllOpenIssuesInChannel,
  createGithubIssueSlackThread,
  deleteInstallation,
  getCurrentFirstResponder,
  getFirstResponderStats,
  getIssueThreadsFromIssue,
  getSlackBotToken,
  setFirstResponder,
} from "./db.js";
import {
  findGithubIssueLinks,
  getIssueStatus,
  issueIdFromUrl,
  postCommentOnIssue,
  renderIssueRef,
} from "./github_utils.js";
import {
  errorMessageOrString,
  getTeamIdFromContext,
  getTeamIdFromShortcut,
  getTeamIdFromSlackAction,
  getTeamIdFromSlashCommand,
  getTeamIdfromViewAction,
  slackTryJoin,
  updateFirstResponderUserGroup,
} from "./slack_utils.js";
import { summarizeConversation } from "./cloudy007.js";
import { draftIssues } from "./cloudy008.js";

const initSlackApp = (slackApp: App) => {
  slackApp.command(/\/cloudy(-dev)?/, async ({ command, ack, respond, client }) => {
    await ack();
    const args = minimist(parseArgsStringToArgv(command.text));
    const showHelp = async () => {
      await respond(
        "Try:\n`/cloudy list all` to list all the issues being tracked\n`/cloudy list #channel-name` to list all issues tracked in a channel\n`/cloudy list https://github.com/lightdash/lightdash/issues/2222` to list all threads for this issue",
      );
    };
    if ((args._ || []).includes("help")) {
      await showHelp();
      return;
    }
    if ((args._ || []).includes("list")) {
      const arg = args._[args._.findIndex((v) => v === "list") + 1];
      if (arg?.startsWith("<http")) {
        const issueUrl = arg.slice(1, -1);
        const rows = await getIssueThreadsFromIssue(issueUrl);
        if (rows.length === 0) {
          await respond(`I can't find any slack threads linked to github issue: ${issueUrl}`);
          return;
        }
        const promises = rows.map((row) =>
          client.chat.getPermalink({
            token: row.bot_token,
            channel: row.channel_id,
            message_ts: row.slack_thread_ts,
          }),
        );
        const results = await Promise.all(promises);
        const permalinks = results.filter((r) => r.ok).map((r) => r.permalink);
        await respond(`I'm tracking that issue in these threads:${permalinks.map((l) => `\n🧵 ${l}`)}`);
      } else if (arg?.startsWith("<#")) {
        const channelRef = arg;
        const channelId = arg.split("|")?.[0]?.slice(2);
        if (!channelId) {
          await respond(`I can't find any slack channels linked to that github issue`);
          return;
        }

        const results = await countAllOpenIssuesInChannel(channelId);
        if (results && results.length > 0) {
          await respond(
            `I'm tracking these github issues in ${channelRef}:\n\n${results
              .map((row) => `🐛 ${row.count === 1 ? "" : `*${row.count}x* `}${row.github_issue_url}`)
              .join("\n")}`,
          );
        } else {
          await respond(`I'm not tracking any issues in ${channelRef}`);
        }
      } else if (arg && arg === "all") {
        const results = await countAllOpenIssues();
        if (results && results.length > 0) {
          await respond(
            `Here are all the issues I'm tracking:\n\n${results
              .map((row) => `🐛 ${row.count === 1 ? "" : `*${row.count}x* `}${row.github_issue_url}`)
              .join("\n")}`,
          );
        } else {
          await respond(`I'm not tracking any issues yet!`);
        }
      } else {
        await showHelp();
      }
      return;
    }
    await showHelp();
  });

  slackApp.shortcut("link_issue", async ({ shortcut, ack, client }) => {
    await ack();

    if (shortcut.type !== "message_action") {
      throw new Error("Expected message action shortcut");
    }

    let messageText: string = "";
    if ("blocks" in shortcut.message) {
      messageText += JSON.stringify(shortcut.message["blocks"]);
    }
    if (shortcut.message.text) {
      messageText += shortcut.message.text;
    }
    if (messageText === "") {
      throw new Error("Expected message text or blocks in message action shortcut");
    }

    const githubLinks = findGithubIssueLinks(messageText);

    const threadTs = shortcut.message["thread_ts"] || shortcut.message_ts;
    const channelId = shortcut.channel.id;

    const teamId = getTeamIdFromShortcut(shortcut);
    const slackBotToken = await getSlackBotToken(teamId);
    const threadPermalink = await client.chat.getPermalink({
      token: slackBotToken,
      channel: channelId,
      message_ts: threadTs,
    });

    for await (const githubLink of githubLinks) {
      const issueStatus = await getIssueStatus(octokitClient, githubLink);
      const isClosed = issueStatus === undefined ? null : issueStatus === "closed";

      try {
        await createGithubIssueSlackThread({
          github_issue_url: githubLink,
          slack_team_id: teamId,
          channel_id: channelId,
          slack_thread_ts: threadTs,
          is_closed: isClosed,
        });
      } catch (e) {
        const maybeRequestError = e as RequestError;

        if (maybeRequestError.message.includes("duplicate key value violates unique constraint")) {
          // do nothing we already subscribed
        } else {
          throw e;
        }
      }
      try {
        await postCommentOnIssue(
          octokitClient,
          githubLink,
          `This issue was mentioned by a user in slack: ${threadPermalink.permalink}`,
        );
      } catch (e) {
        const maybeRequestError = e as RequestError;

        if (maybeRequestError.status === 404) {
          // do nothing, issue doesn't exist
        } else {
          // log out the error but don't crash the handler
          console.error(e);
        }
      }
    }

    const githubLinksWithThreads: Record<string, Awaited<ReturnType<typeof getIssueThreadsFromIssue>>> = {};

    for (const githubLink of githubLinks) {
      const threads = await getIssueThreadsFromIssue(githubLink);
      githubLinksWithThreads[githubLink] = threads;
    }

    if (githubLinks.length === 0) {
      await slackTryJoin(
        () =>
          client.chat.postMessage({
            text: `I couldn't find any github issue links in that message`,
            channel: channelId,
            thread_ts: threadTs,
          }),
        client,
        channelId,
      );
    } else if (githubLinks.length === 1) {
      const [firstGithubLink] = githubLinks;

      if (firstGithubLink === undefined) {
        throw new Error("Expected first github link");
      }

      const threads = githubLinksWithThreads[firstGithubLink];
      const totalRequests = threads && threads.length > 0 ? threads.length - 1 : 0;

      const text =
        totalRequests > 0
          ? `I've upvoted ${renderIssueRef(
              firstGithubLink,
            )} for you! This issue has been requested by ${totalRequests} other users.\n\nI'm tracking it, so I'll notify everyone here as soon as it's fixed.`
          : `I've upvoted ${renderIssueRef(
              firstGithubLink,
            )} for you! You're the first user to request this issue.\n\nI'm tracking it, so I'll notify everyone here as soon as it's fixed.`;

      await slackTryJoin(
        () =>
          client.chat.postMessage({
            text: text,
            channel: channelId,
            thread_ts: threadTs,
            unfurl_links: false,
            unfurl_media: false,
          }),
        client,
        channelId,
      );
    } else {
      let text = `I've upvoted these issues for you:\n`;

      for (const githubLink of githubLinks) {
        const threads = githubLinksWithThreads[githubLink];
        const totalRequests = threads && threads.length > 0 ? threads.length - 1 : 0;

        if (totalRequests > 0) {
          text += `\n🛠️ ${renderIssueRef(githubLink)} - this issue has been requested by ${totalRequests} other users.`;
        } else {
          text += `\n🛠️ ${renderIssueRef(githubLink)} - you're the first user to request this issue.`;
        }
      }

      await slackTryJoin(
        () =>
          client.chat.postMessage({
            text: text,
            channel: channelId,
            thread_ts: threadTs,
            unfurl_links: false,
            unfurl_media: false,
          }),
        client,
        channelId,
      );
    }

    const setBookmarks = async (channelId: string, bookmarks: { key: string; value: string; link: string }[]) => {
      const results = await client.bookmarks.list({ channel_id: channelId });
      if (!results.ok) {
        return;
      }
      const existingBookmarks = results.bookmarks;
      for await (const bookmark of bookmarks) {
        const match = existingBookmarks?.find((b) => b.title?.startsWith(bookmark.key));
        if (match?.id && match?.channel_id) {
          await client.bookmarks.edit({
            channel_id: match.channel_id,
            bookmark_id: match.id,
            link: bookmark.link,
            title: `${bookmark.key} (${bookmark.value})`,
          });
        } else {
          await client.bookmarks.add({
            channel_id: channelId,
            title: `${bookmark.key} (${bookmark.value})`,
            type: "link",
            link: bookmark.link,
          });
        }
      }
    };
    const openIssueUrls = await allOpenIssueUrlsInChannel(channelId);
    const totalIssues = openIssueUrls.length;
    const issueIds = openIssueUrls.slice(0, 50).map(issueIdFromUrl); // GitHub url appears to only support 50 issue ids
    const issueListHtmlUrl = `https://github.com/lightdash/lightdash/issues/?q=is%3Aissue+is%3Aopen+${issueIds.join(
      "+",
    )}`;
    await setBookmarks(channelId, [
      {
        key: "Open github issues",
        value: String(totalIssues),
        link: issueListHtmlUrl,
      },
    ]);
  });

  slackApp.command(/\/first-responder(-dev)?|\/fr(-dev)?/, async ({ command, ack, respond, client }) => {
    await ack();
    try {
      const teamId = getTeamIdFromSlashCommand(command);

      // Check for stats subcommand
      const args = minimist(parseArgsStringToArgv(command.text));
      if ((args._ || []).includes("stats")) {
        const stats = await getFirstResponderStats(teamId);
        if (stats.length === 0) {
          await respond({
            text: "No first responder activity in the last 7 days.",
          });
          return;
        }

        // Format the stats message
        let blocks: KnownBlock[] = [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "📊 First Responder Stats (Last 7 Days)",
              emoji: true,
            },
          },
          {
            type: "divider",
          },
        ];

        // Add each user's stats to the blocks
        stats.forEach((stat, index) => {
          const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "👏";

          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${medal} *<@${stat.slack_user_id}>*: *${stat.total_hours}* hours`,
            },
          });
        });

        // Add total support hours
        const totalHours = stats.reduce((sum, stat) => sum + stat.total_hours, 0);
        blocks.push({
          type: "divider",
        });
        blocks.push({
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `*Total team support: ${Math.round(totalHours * 10) / 10} hours in the last 7 days* 💪`,
            },
          ],
        });

        await respond({
          blocks: blocks,
        });
        return;
      }

      const currentResponder = await getCurrentFirstResponder(teamId);

      let message = "There is currently no first responder assigned.";
      if (currentResponder) {
        const userInfo = await client.users.info({
          user: currentResponder.slack_user_id,
        });

        if (!userInfo.ok || !userInfo.user) {
          throw new Error(`Failed to get user info: ${userInfo.error}`);
        }

        const duration = Math.floor((Date.now() - new Date(currentResponder.started_at).getTime()) / (1000 * 60 * 60));
        message = `🎯 <@${currentResponder.slack_user_id}> (${userInfo.user.real_name}) is first responder! 🌟\n\nThey've been helping out for ${duration} hours 🕒`;
      }

      await respond({
        text: message,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: message,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "I'll be first responder",
                  emoji: true,
                },
                action_id: "become_first_responder",
                style: "primary",
              },
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "Select another user",
                  emoji: true,
                },
                action_id: "select_first_responder",
              },
            ],
          },
        ],
      });
    } catch (error) {
      console.error("Error in first responder command:", error);
      Sentry.captureException(error);
      await respond({
        text: `Sorry, there was an error processing your request: ${errorMessageOrString(error)}`,
        response_type: "ephemeral",
      });
    }
  });

  slackApp.action("become_first_responder", async ({ ack, body, respond, client }) => {
    await ack();
    try {
      const teamId = getTeamIdFromSlackAction(body);
      await setFirstResponder(teamId, body.user.id);

      // Update the first-responder user group
      await updateFirstResponderUserGroup(client, body.user.id);

      await respond({
        text: `You are now the first responder!`,
        replace_original: true,
      });
    } catch (error) {
      console.error("Error in become_first_responder action:", error);
      Sentry.captureException(error);
      await respond({
        text: `Sorry, there was an error setting you as first responder: ${errorMessageOrString(error)}`,
        response_type: "ephemeral",
      });
    }
  });

  slackApp.action("select_first_responder", async ({ ack, body, client, respond }) => {
    if (body.type !== "block_actions") {
      throw new Error("Expected interactive message");
    }

    if (!body.channel) {
      throw new Error(`Expected channel to be defined`);
    }

    try {
      await ack();

      await client.views.open({
        trigger_id: body.trigger_id,
        view: {
          type: "modal",
          callback_id: "select_first_responder_modal",
          private_metadata: body.channel.id,
          title: {
            type: "plain_text",
            text: "Select First Responder",
            emoji: true,
          },
          submit: {
            type: "plain_text",
            text: "Submit",
            emoji: true,
          },
          close: {
            type: "plain_text",
            text: "Cancel",
            emoji: true,
          },
          blocks: [
            {
              type: "input",
              block_id: "user_select",
              element: {
                type: "users_select",
                placeholder: {
                  type: "plain_text",
                  text: "Select a user",
                  emoji: true,
                },
                action_id: "users_select-action",
              },
              label: {
                type: "plain_text",
                text: "Choose the new first responder",
                emoji: true,
              },
            },
          ],
        },
      });
    } catch (error) {
      console.error("Error opening first responder selection modal:", error);
      Sentry.captureException(error);
      await respond({
        text: `Sorry, there was an error opening the selection modal: ${errorMessageOrString(error)}`,
        response_type: "ephemeral",
      });
    }
  });

  slackApp.view("select_first_responder_modal", async ({ ack, body, view, client }) => {
    try {
      const selectedUser = view.state?.values?.["user_select"]?.["users_select-action"]?.selected_user;
      if (!selectedUser) {
        throw new Error("No user selected");
      }

      const settingUserId = body.user.id;
      const teamId = getTeamIdfromViewAction(body);
      await setFirstResponder(teamId, selectedUser);

      // Update the first-responder user group
      await updateFirstResponderUserGroup(client, selectedUser);

      // Only send DM if someone else set them as first responder
      if (selectedUser !== settingUserId) {
        const settingUserInfo = await client.users.info({
          user: settingUserId,
        });

        if (!settingUserInfo.ok) {
          console.error("Failed to get setting user info", settingUserInfo.error);
          throw new Error("Failed to get setting user info");
        }

        if (!settingUserInfo.user) {
          console.error("Failed to get setting user info", settingUserInfo.error);
          throw new Error("Failed to get setting user info");
        }

        await client.chat.postMessage({
          channel: selectedUser,
          text: `You have been assigned as the first responder by <@${settingUserId}> (${settingUserInfo.user.real_name})! Thank you for helping users.`,
        });
      }

      // Update the modal with a confirmation message via ack
      await ack({
        response_action: "update",
        view: {
          type: "modal",
          title: {
            type: "plain_text",
            text: "First Responder Updated",
            emoji: true,
          },
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `✅ <@${selectedUser}> is now the first responder!`,
              },
            },
          ],
          close: {
            type: "plain_text",
            text: "Ok",
            emoji: true,
          },
        },
      });
    } catch (error) {
      console.error("Error in select_first_responder_modal submission:", error);
      Sentry.captureException(error);

      // Update the modal with an error message via ack
      await ack({
        response_action: "update",
        view: {
          type: "modal",
          title: {
            type: "plain_text",
            text: "Error",
            emoji: true,
          },
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `❌ Sorry, there was an error setting the first responder: ${errorMessageOrString(error)}`,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: "Please try again or contact an administrator.",
                },
              ],
            },
          ],
        },
      });
    }
  });

  slackApp.event("app_uninstalled", async ({ context }) => {
    try {
      const teamId = getTeamIdFromContext(context);
      await deleteInstallation({
        isEnterpriseInstall: context.isEnterpriseInstall,
        enterpriseId: context.enterpriseId,
        teamId: context.teamId,
      });
      console.info(`[SLACK] App uninstalled from team ${teamId}, installation deleted`);
    } catch (error) {
      console.error(`Error deleting installation for team ${context.teamId}:`, error);
      Sentry.captureException(error);
    }
  });

  slackApp.shortcut("summarize_thread", async ({ shortcut, ack, client }) => {
    await ack();

    if (shortcut.type !== "message_action") {
      throw new Error("Expected message action shortcut");
    }

    const threadOrMessageTs = shortcut.message["thread_ts"] || shortcut.message_ts;
    const channelId = shortcut.channel.id;

    const allMessages = await client.conversations.replies({
      channel: channelId,
      ts: threadOrMessageTs,
    });

    const messagesWithAuthor: {
      author: string;
      message: string;
    }[] =
      allMessages.messages?.map((message) => ({
        author: message.user ?? "",
        message: message.text ?? "",
      })) ?? [];

    const { object: summary } = await summarizeConversation(
      messagesWithAuthor.map((m) => `${m.author}: ${m.message}`).join("\n"),
    );

    const severityEmojis = {
      low: "🟢",
      medium: "🟠",
      high: "🔴",
    } as const;
    const angerEmojis = {
      none: "😌",
      mild: "😠",
      strong: "😡",
    } as const;

    client.chat.postEphemeral({
      channel: channelId,
      thread_ts: threadOrMessageTs,
      icon_emoji: ":writing_hand:",
      text: summary.summary,
      user: shortcut.user.id,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: summary.summary },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `*Resolved:* ${summary.resolved ? "✅ Yes" : "❌ No"}`,
            },
            {
              type: "mrkdwn",
              text: `*Severity:* ${severityEmojis[summary.severity]}`,
            },
            {
              type: "mrkdwn",
              text: `*Anger Level:* ${angerEmojis[summary.angerLevel]}`,
            },
          ],
        },
      ],
    });
  });

  slackApp.shortcut("draft_issues", async ({ ack, shortcut, client }) => {
    await ack();

    if (shortcut.type !== "message_action") {
      throw new Error("Expected message action shortcut");
    }

    const threadOrMessageTs = shortcut.message["thread_ts"] || shortcut.message_ts;
    const channelId = shortcut.channel.id;

    await draftIssues({ channelId, threadOrMessageTs, client, user: shortcut.user });
  });
};

export default initSlackApp;
