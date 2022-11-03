import bolt from '@slack/bolt';
import Analytics from '@rudderstack/rudder-sdk-node';
import {
  createGithubIssueSlackThread,
  createInstallation,
  deleteInstallation, getIssueThreadsFromIssue,
  getInstallation, getIssueThreadsFromChannelId,
} from "./db.js";
const { App, ExpressReceiver } = bolt;
import octokit from '@octokit/webhooks';
const { Webhooks, createNodeMiddleware } = octokit;
import minimist from 'minimist';
import * as StringArgv from 'string-argv';
import {getTeamId} from "./slack.js";
const {parseArgsStringToArgv} = StringArgv

const githubWebhooks = new Webhooks({secret: process.env.GITHUB_WEBHOOKS_SECRET})

const analyticsClient = new Analytics(
  process.env.RUDDERSTACK_WRITE_KEY,
  `${process.env.RUDDERSTACK_DATA_PLANE_URL}/v1/batch`
);

const expressReceiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: [
    'app_mentions:read',
    'channels:history',
    'channels:read',
    'chat:write',
    'commands',
    'users.profile:read',
    'users:read',
    'users:read.email',
    'channels:join',
  ],
  installationStore: {
    storeInstallation: createInstallation,
    fetchInstallation: getInstallation,
    deleteInstallation,
  },
})
const app = new App({
  receiver: expressReceiver,
});

const renderIssueRef = (issueUrl) => {
  const issueId = issueUrl.split('/').pop();
  return `<${issueUrl}|issue #${issueId}>`;
}

githubWebhooks.on('issues.assigned', async ({ payload}) => {
  const issueUrl = payload.issue.html_url;
  const slack_threads = await getIssueThreadsFromIssue(issueUrl);
  for await (const slack_thread of slack_threads) {
    await app.client.chat.postMessage({
      text: `🥳 <${payload.issue.assignee.html_url}|${payload.issue.assignee.login}> has started work on ${renderIssueRef(issueUrl)}!`,
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
  const slack_threads = await getIssueThreadsFromIssue(issueUrl);
  for await (const slack_thread of slack_threads) {
    await app.client.chat.postMessage({
      text: `✅ We've fixed ${renderIssueRef(issueUrl)}: _${payload.issue.title}_\n\nLightdash Cloud users will automatically get the fix once your instance updates (All instances update at 01:00 PST [10:00 CET] daily). Self-hosted users should update to the latest version to get the fix 🎉`,
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
    await respond('Try:\n`/cloudy list #channel-name` to list all issues tracked in a channel\n`/cloudy list https://github.com/lightdash/lightdash/issues/2222` to list all threads for this issue')
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
      const rows = await getIssueThreadsFromChannelId(channelId)
      if (rows && rows.length > 0) {
        const issues = Object.entries(rows.reduce((acc, next) => {
          return {
            ...acc,
            [next.github_issue_url]: (acc[next.github_issue_url] || 0) + 1,
          }
        }, {})).sort((a, b) => a[1] - b[1]);
        await respond(`I'm tracking these github issues in ${channelRef}\n${issues.map(i => `\n🐛  ${i[1] === 1 ? '' : `*${i[1]}x* `}${i[0]}`)}`);
      }
      else {
        await respond(`I'm not tracking any issues in ${channelRef}`);
      }
    }
    else {
      await showHelp();
    }
    return;
  }
  await showHelp();
})

app.shortcut('link_issue', async ({shortcut, ack, client, logger, say}) => {
  await ack();
  const links = shortcut.message.blocks.flatMap(b => b.elements).flatMap(a => a.elements).filter(e => e.type === 'link').map(l => l.url);
  const githubLinkRegex = /https:\/\/github.com\/[^\/]+\/[^\/]+\/issues\/[0-9]+/
  const githubLinks = links.filter(url => githubLinkRegex.exec(url));
  const threadTs = shortcut.message.thread_ts || shortcut.message_ts;
  const channelId = shortcut.channel.id;
  const teamId = getTeamId(shortcut);
  for await (const githubLink of githubLinks) {
    try {
      await createGithubIssueSlackThread(githubLink, teamId, channelId, threadTs);
    } catch (e) {
      if ((e.constraint && e.constraint === 'github_issue_slack_threads_pkey')) {
        // do nothing we already subscribed
      } else {
        throw e;
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

  if (githubLinks.length === 0) {
    await joinAndSay({text: `I couldn't find any github issue links in that message`, thread_ts: threadTs});
  } else if (githubLinks.length === 1) {
    const [firstGithubLink] = githubLinks;
    await joinAndSay({
      text: `I'm keeping an eye on ${renderIssueRef(firstGithubLink)}\n\nI'll notify everyone here as soon as it's fixed!`,
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false
    });
  } else {
    const allIssues = githubLinks.map(renderIssueRef).map(s => `🛠 ${s}`).join('\n')
    await joinAndSay({
      text: `I'm keeping an eye on the following issues:\n${allIssues}\n\nI'll notify everyone here as soon as any are fixed!`,
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false
    })
  }
});

(async () => {
  await app.start(3001);
  console.log("Bolt app running on localhost:3001");
})();

expressReceiver.app.use(createNodeMiddleware(githubWebhooks));

expressReceiver.app.get('/healthz', (_, res) => {
  res.status(200).send();
})
