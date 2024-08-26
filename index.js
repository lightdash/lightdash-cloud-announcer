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
} from "./db.js";
const { App, ExpressReceiver } = bolt;
import octokit from '@octokit/webhooks';
const { Webhooks, createNodeMiddleware } = octokit;
import minimist from 'minimist';
import * as StringArgv from 'string-argv';
import {getTeamId} from "./slack.js";
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
    const lastMessage = getLastComment(octokitClient, issueUrl) || 'No information provided';
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

expressReceiver.app.use(createNodeMiddleware(githubWebhooks));

expressReceiver.app.get('/healthz', (_, res) => {
  res.status(200).send();
})

Sentry.setupExpressErrorHandler(expressReceiver.app);

(async () => {
  await app.start(3001);
  console.log("Bolt app running on localhost:3001");
})()
    .catch((e) => console.error(e));
