import bolt from '@slack/bolt';
import {
  createGithubIssueSlackThread,
  createInstallation,
  deleteInstallation,
  getIssueThreadsFromIssue,
  getInstallation,
  countAllOpenIssues,
  countAllOpenIssuesInChannel,
  setIssueIsClosed,
  allOpenIssueUrlsInChannel, getSlackBotToken,
  getCurrentFirstResponder,
  setFirstResponder,
  getFirstResponderStats,
} from "./db.js";
const { App, ExpressReceiver } = bolt;
import octokit from '@octokit/webhooks';
const { Webhooks, createNodeMiddleware } = octokit;
import minimist from 'minimist';
import * as StringArgv from 'string-argv';
import {getTeamId, updateFirstResponderUserGroup} from "./slack.js";
const {parseArgsStringToArgv} = StringArgv
import { Octokit } from 'octokit';
import {getIssueStatus, postCommentOnIssue, getLastComment} from "./github.js";
import * as Sentry from '@sentry/node';

// Setup Sentry
Sentry.init({
  dsn: process.env.SENTRY_DSN,
});

// Github webhooks config
const githubWebhooks = new Webhooks({secret: process.env.GITHUB_WEBHOOKS_SECRET})

// Github REST API config
const octokitClient = new Octokit({
  auth: process.env.GITHUB_ACCESS_TOKEN,
})

const expressReceiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: [
    "app_mentions:read",
    "bookmarks:read",
    "bookmarks:write",
    "channels:history",
    "channels:join",
    "channels:read",
    "chat:write",
    "commands",
    "users:read.email",
    "users:read",
    "users.profile:read",
    "usergroups:write",
    "usergroups:read",
  ],
  installationStore: {
    storeInstallation: createInstallation,
    fetchInstallation: getInstallation,
    deleteInstallation,
  },
});

const app = new App({
  receiver: expressReceiver,
  logLevel: process.env.ENV === 'development' ? 'DEBUG' : 'INFO',
});

/**
 * @param { string } issueUrl
 * @returns { string }
 */
const issueIdFromUrl = (issueUrl) => {
    return issueUrl.split('/').pop();
}

const renderIssueRef = (issueUrl) => {
  const issueId = issueIdFromUrl(issueUrl);
  return `<${issueUrl}|issue #${issueId}>`;
}

githubWebhooks.on('issues.assigned', async ({ payload}) => {
  const issueUrl = payload.issue.html_url;
  const slack_threads = await getIssueThreadsFromIssue(issueUrl);
  const assignees = (payload.issue.assignees || [])
      .filter(a => !!a)
      .map(a => `<${a.html_url}|${a.login}>`).join(', ');
  const text = `🥳 ${assignees} started work on ${renderIssueRef(issueUrl)}!`
  for await (const slack_thread of slack_threads) {
    await app.client.chat.postMessage({
      text,
      token: slack_thread.bot_token,
      channel: slack_thread.channel_id,
      thread_ts: slack_thread.slack_thread_ts,
      unfurl_links: false,
      unfurl_media: false,
    })
  }
})

githubWebhooks.on('issues.closed', async({ payload }) => {
  const issueUrl = payload.issue.html_url;
  await setIssueIsClosed(issueUrl, true);
  let message = `Issue ${renderIssueRef(issueUrl)} was closed`; // default message
  if (payload.issue.state_reason === 'completed') {
    message = `✅ We've fixed ${renderIssueRef(issueUrl)}: _${payload.issue.title}_\n\nLightdash Cloud users will automatically get the fix once your instance updates (All instances update at 01:00 PST [10:00 CET] daily). Self-hosted users should update to the latest version to get the fix 🎉`
  }
  else if (payload.issue.state_reason === 'not_planned') {
    const lastMessage = (await getLastComment(octokitClient, issueUrl)) || 'No information provided';
    message = `🗑 Issue ${renderIssueRef(issueUrl)} is no longer planned to be fixed.\n> ${lastMessage}\nCheck out the linked issue for more information.`
  }
  const slack_threads = await getIssueThreadsFromIssue(issueUrl);
  for await (const slack_thread of slack_threads) {
    await app.client.chat.postMessage({
      text: message,
      token: slack_thread.bot_token,
      channel: slack_thread.channel_id,
      thread_ts: slack_thread.slack_thread_ts,
      unfurl_links: false,
      unfurl_media: false,
    })
  }
})

githubWebhooks.on('issues.reopened', async({payload}) => {
  const issueUrl = payload.issue.html_url;
  await setIssueIsClosed(issueUrl, false);
  const slack_threads = await getIssueThreadsFromIssue(issueUrl);
  for await (const slack_thread of slack_threads) {
    await app.client.chat.postMessage({
      text: `🔧 We've reopened this issue: ${renderIssueRef(issueUrl)}: _${payload.issue.title}_\n\nI'll notify everybody here as soon as there's another update.`,
      token: slack_thread.bot_token,
      channel: slack_thread.channel_id,
      thread_ts: slack_thread.slack_thread_ts,
      unfurl_links: false,
      unfurl_media: false,
    })
  }
})

app.command(/\/cloudy(-dev)?/, async ({ command, ack, respond, client }) => {
  await ack();
  const args = minimist(parseArgsStringToArgv(command.text));
  const showHelp = async () => {
    await respond('Try:\n`/cloudy list all` to list all the issues being tracked\n`/cloudy list #channel-name` to list all issues tracked in a channel\n`/cloudy list https://github.com/lightdash/lightdash/issues/2222` to list all threads for this issue')
  };
  if ((args._ ||[]).includes('help')) {
    await showHelp();
    return;
  }
  if ((args._ || []).includes('list')) {
    const arg = args._[args._.findIndex(v => v === 'list')+1];
    if (arg && arg.startsWith('<http')) {
      const issueUrl = arg.slice(1, -1)
      const rows = await getIssueThreadsFromIssue(issueUrl);
      if (rows.length === 0) {
        await respond(`I can't find any slack threads linked to github issue: ${issueUrl}`);
        return;
      }
      const promises = rows.map(row => client.chat.getPermalink({
        token: row.bot_token,
        channel: row.channel_id,
        message_ts: row.slack_thread_ts})
      );
      const results = await Promise.all(promises);
      const permalinks = results.filter(r => r.ok).map(r => r.permalink);
      await respond(`I'm tracking that issue in these threads:${permalinks.map(l => `\n🧵 ${l}`)}`) ;
    }
    else if (arg && arg.startsWith('<#')) {
      const channelRef = arg;
      const channelId = arg.split('|')[0].slice(2)
      const results = await countAllOpenIssuesInChannel(channelId);
      if (results && results.length > 0) {
        await respond(`I'm tracking these github issues in ${channelRef}:\n${results.map(row => `\n🐛 ${row.count === 1 ? '' : `*${row.count}x* `}${row.github_issue_url}`)}`);
      }
      else {
        await respond(`I'm not tracking any issues in ${channelRef}`);
      }
    }
    else if (arg && arg === 'all') {
      const results = await countAllOpenIssues();
      if (results && results.length > 0) {
        await respond(`Here are all the issues I'm tracking:\n${results.map(row => `\n🐛 ${row.count === 1 ? '' : `*${row.count}x* `}${row.github_issue_url}`)}`);
      }
      else {
        await respond(`I'm not tracking any issues yet!`);
      }
    }
    else {
      await showHelp();
    }
    return;
  }
  await showHelp();
})

const findLinks = blocks =>
  blocks.flatMap(block =>
    block.elements.flatMap(element =>
      element.type === 'link'
        ? [element.url]
        : element.elements
        ? findLinks([{elements: element.elements}])
        : []
    )
  );

app.shortcut('link_issue', async ({shortcut, ack, client, say}) => {
  await ack();

  const links = findLinks(shortcut.message.blocks)
  const githubLinkRegex = /https:\/\/github.com\/[^\/]+\/[^\/]+\/issues\/[0-9]+/
  const githubLinks = links.filter(url => githubLinkRegex.exec(url));

  const threadTs = shortcut.message.thread_ts || shortcut.message_ts;
  const channelId = shortcut.channel.id;
  const teamId = getTeamId(shortcut);
  const slackBotToken = await getSlackBotToken(teamId);
  const threadPermalink = await client.chat.getPermalink({
    token: slackBotToken,
    channel: channelId,
    message_ts: threadTs,
  });
  for await (const githubLink of githubLinks) {
    const issueStatus = await getIssueStatus(octokitClient, githubLink);
    const isClosed = issueStatus === undefined ? undefined : issueStatus === 'closed';
    try {
      await createGithubIssueSlackThread(githubLink, teamId, channelId, threadTs, isClosed);
    } catch (e) {
      if ((e.constraint && e.constraint === 'github_issue_slack_threads_pkey')) {
        // do nothing we already subscribed
      } else {
        throw e;
      }
    }
    try {
      await postCommentOnIssue(octokitClient, githubLink, `This issue was mentioned by a user in slack: ${threadPermalink.permalink}`);
    } catch (e) {
        if (e.status === 404) {
            // do nothing, issue doesn't exist
        } else {
          // log out the error but don't crash the handler
          console.error(e);
        }
    }
  }

  const joinAndSay = async (args) => {
    try {
      await say(args);
    } catch (e) {
      if (e.code === 'slack_webapi_platform_error' && e.data?.error === 'not_in_channel') {
        await client.conversations.join({channel: channelId});
        await say(args);
      }
      else {
        throw e;
      }
    }
  }

  const githubLinksWithThreads = {};
  for (const githubLink of githubLinks) {
    const threads = await getIssueThreadsFromIssue(githubLink);
    githubLinksWithThreads[githubLink] = threads;
  }

  if (githubLinks.length === 0) {
    await joinAndSay({
      text: `I couldn't find any github issue links in that message`,
      thread_ts: threadTs,
    });
  } else if (githubLinks.length === 1) {
    const [firstGithubLink] = githubLinks;

    const threads = githubLinksWithThreads[firstGithubLink];
    const totalRequests =
      threads && threads.length > 0
        ? threads.length - 1
        : 0;

    const text =
      totalRequests > 0
        ? `I've upvoted ${renderIssueRef(
            firstGithubLink
          )} for you! This issue has been requested by ${
            totalRequests
          } other users.\n\nI'm tracking it, so I'll notify everyone here as soon as it's fixed.`
        : `I've upvoted ${renderIssueRef(
            firstGithubLink
          )} for you! You're the first user to request this issue.\n\nI'm tracking it, so I'll notify everyone here as soon as it's fixed.`;

    await joinAndSay({
      text: text,
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false,
    });
  } else {
    let text = `I've upvoted these issues for you:\n`;

    for (const githubLink of githubLinks) {
      const threads = githubLinksWithThreads[githubLink];
      const totalRequests =
      threads && threads.length > 0
        ? threads.length - 1
        : 0;

      if (totalRequests > 0) {
        text += `\n🛠️ ${renderIssueRef(
          githubLink
        )} - this issue has been requested by ${
          totalRequests
        } other users.`;
      } else {
        text += `\n🛠️ ${renderIssueRef(
          githubLink
        )} - you're the first user to request this issue.`;
      }
    }

    await joinAndSay({
      text: text,
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false,
    });
  }

  /**
   *
   * @param {string}channelId
   * @param {{key: string, value: string, link: string}[]}bookmarks
   * @returns {Promise<void>}
   */
  const setBookmarks = async (channelId, bookmarks) => {
    const results = await client.bookmarks.list({channel_id: channelId});
    if (!results.ok) {
      return;
    }
    const existingBookmarks = results.bookmarks;
    for await (const bookmark of bookmarks) {
      const match = existingBookmarks.find(existing => existing.title.startsWith(bookmark.key));
      if (match) {
        await client.bookmarks.edit({
          channel_id: match.channel_id,
          bookmark_id: match.id,
          link: bookmark.link,
          title: `${bookmark.key} (${bookmark.value})`,
        })
      }
      else {
        await client.bookmarks.add({
          channel_id: channelId,
          title: `${bookmark.key} (${bookmark.value})`,
          type: 'link',
          link: bookmark.link,
        })
      }
    }
  }
  const openIssueUrls = await allOpenIssueUrlsInChannel(channelId);
  const totalIssues = openIssueUrls.length;
  const issueIds = openIssueUrls.slice(0, 50).map(issueIdFromUrl); // GitHub url appears to only support 50 issue ids
  const issueListHtmlUrl = `https://github.com/lightdash/lightdash/issues/?q=is%3Aissue+is%3Aopen+${issueIds.join('+')}`
  await setBookmarks(channelId, [{
    key: 'Open github issues',
    value: totalIssues,
    link: issueListHtmlUrl,
  }]);
});

// First responder command
app.command(/\/first-responder(-dev)?|\/fr(-dev)?/, async ({ command, ack, respond, client }) => {
  await ack();
  try {
    const teamId = getTeamId(command);
    
    // Check for stats subcommand
    const args = minimist(parseArgsStringToArgv(command.text));
    if ((args._ || []).includes('stats')) {
      const stats = await getFirstResponderStats(teamId);
      if (stats.length === 0) {
        await respond({
          text: "No first responder activity in the last 7 days."
        });
        return;
      }
      
      // Format the stats message
      let blocks = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "📊 First Responder Stats (Last 7 Days)",
            emoji: true
          }
        },
        {
          type: "divider"
        }
      ];
      
      // Add each user's stats to the blocks
      stats.forEach((stat, index) => {
        const medal = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : "👏";
        
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${medal} *<@${stat.slack_user_id}>*: *${stat.total_hours}* hours`
          }
        });
      });
      
      // Add total support hours
      const totalHours = stats.reduce((sum, stat) => sum + stat.total_hours, 0);
      blocks.push({
        type: "divider"
      });
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `*Total team support: ${Math.round(totalHours * 10) / 10} hours in the last 7 days* 💪`
          }
        ]
      });
      
      await respond({
        blocks: blocks
      });
      return;
    }
    
    const currentResponder = await getCurrentFirstResponder(teamId);
    
    let message = "There is currently no first responder assigned.";
    if (currentResponder) {
      const userInfo = await client.users.info({
        user: currentResponder.slack_user_id
      });
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
            text: message
          }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "I'll be first responder",
                emoji: true
              },
              action_id: "become_first_responder",
              style: "primary"
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Select another user",
                emoji: true
              },
              action_id: "select_first_responder"
            }
          ]
        }
      ]
    });
  } catch (error) {
    console.error('Error in first responder command:', error);
    Sentry.captureException(error);
    await respond({
      text: `Sorry, there was an error processing your request: ${error.message}`,
      response_type: 'ephemeral'
    });
  }
});

// Handle "I'll be first responder" button
app.action('become_first_responder', async ({ action, ack, body, respond, client }) => {
  await ack();
  try {
    const teamId = getTeamId(body);
    await setFirstResponder(teamId, body.user.id);
    
    // Update the first-responder user group
    await updateFirstResponderUserGroup(client, body.user.id);
    
    await respond({
      text: `You are now the first responder!`,
      replace_original: true
    });
  } catch (error) {
    console.error('Error in become_first_responder action:', error);
    Sentry.captureException(error);
    await respond({
      text: `Sorry, there was an error setting you as first responder: ${error.message}`,
      response_type: 'ephemeral'
    });
  }
});

// Handle "Select another user" button
app.action('select_first_responder', async ({ ack, body, client, respond }) => {
  try {
    await ack();
    const view = {
      type: "modal",
      callback_id: "select_first_responder_modal",
      private_metadata: body.channel.id,
      title: {
        type: "plain_text",
        text: "Select First Responder",
        emoji: true
      },
      submit: {
        type: "plain_text",
        text: "Submit",
        emoji: true
      },
      close: {
        type: "plain_text",
        text: "Cancel",
        emoji: true
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
              emoji: true
            },
            action_id: "users_select-action"
          },
          label: {
            type: "plain_text",
            text: "Choose the new first responder",
            emoji: true
          }
        }
      ]
    };

    await client.views.open({
      trigger_id: body.trigger_id,
      view: view
    });
  } catch (error) {
    console.error('Error opening first responder selection modal:', error);
    Sentry.captureException(error);
    await respond({
      text: `Sorry, there was an error opening the selection modal: ${error.message}`,
      response_type: 'ephemeral'
    });
  }
});

// Handle first responder modal submission
app.view('select_first_responder_modal', async ({ ack, body, view, client }) => {
  try {
    const selectedUser = view.state.values.user_select['users_select-action'].selected_user;
    const settingUserId = body.user.id;
    const teamId = getTeamId(body);
    await setFirstResponder(teamId, selectedUser);
    
    // Update the first-responder user group
    await updateFirstResponderUserGroup(client, selectedUser);
    
    // Only send DM if someone else set them as first responder
    if (selectedUser !== settingUserId) {
      const settingUserInfo = await client.users.info({
        user: settingUserId
      });
      await client.chat.postMessage({
        channel: selectedUser,
        text: `You have been assigned as the first responder by <@${settingUserId}> (${settingUserInfo.user.real_name})! Thank you for helping users.`
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
          emoji: true
        },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `✅ <@${selectedUser}> is now the first responder!`
            }
          },
        ],
        close: {
          type: "plain_text",
          text: "Ok",
          emoji: true
        }
      }
    });
  } catch (error) {
    console.error('Error in select_first_responder_modal submission:', error);
    Sentry.captureException(error);
    
    // Update the modal with an error message via ack
    await ack({
      response_action: "update",
      view: {
        type: "modal",
        title: {
          type: "plain_text",
          text: "Error",
          emoji: true
        },
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `❌ Sorry, there was an error setting the first responder: ${error.message}`
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: "Please try again or contact an administrator."
              }
            ]
          }
        ]
      }
    });
  }
});

expressReceiver.app.use(createNodeMiddleware(githubWebhooks));

expressReceiver.app.get('/healthz', (_, res) => {
  res.status(200).send();
})

app.event('app_uninstalled', async ({ event, context }) => {
  try {
    const teamId = context.teamId;
    await deleteInstallation({ teamId });
    console.log(`App uninstalled from team ${teamId}, installation deleted`);
  } catch (error) {
    console.error(`Error deleting installation for team ${context.teamId}:`, error);
    Sentry.captureException(error);
  }
});

Sentry.setupExpressErrorHandler(expressReceiver.app);

(async () => {
  await app.start(3001);
  console.log("Bolt app running on localhost:3001");
})()
    .catch((e) => console.error(e));
