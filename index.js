import bolt from '@slack/bolt';
import Analytics from '@rudderstack/rudder-sdk-node';
import {createGithubIssueSlackThread, getSlackThreads} from "./db.js";
const { App, ExpressReceiver } = bolt;
import octokit from '@octokit/webhooks';
const { Webhooks, createNodeMiddleware } = octokit;

const githubWebhooks = new Webhooks({secret: process.env.GITHUB_WEBHOOKS_SECRET})

const analyticsClient = new Analytics(
  process.env.RUDDERSTACK_WRITE_KEY,
  `${process.env.RUDDERSTACK_DATA_PLANE_URL}/v1/batch`
);

const expressReceiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET })
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: expressReceiver,
});

const renderIssueRef = (issueUrl) => {
  const issueId = issueUrl.split('/').pop();
  return `<${issueUrl}|issue #${issueId}>`;
}

githubWebhooks.on('issues.assigned', async ({ payload}) => {
  const issueUrl = payload.issue.html_url;
  const slack_threads = await getSlackThreads(issueUrl);
  for await (const slack_thread of slack_threads) {
    await app.client.chat.postMessage({
      text: `🥳 <${payload.issue.assignee.html_url}|${payload.issue.assignee.login}> has started work on ${renderIssueRef(issueUrl)}!`,
      channel: slack_thread.channel_id,
      thread_ts: slack_thread.slack_thread_ts,
      unfurl_links: false,
      unfurl_media: false,
    })
  }
})

githubWebhooks.on('issues.closed', async({ payload }) => {
  const issueUrl = payload.issue.html_url;
  const slack_threads = await getSlackThreads(issueUrl);
  for await (const slack_thread of slack_threads) {
    await app.client.chat.postMessage({
      text: `✅ We've fixed ${renderIssueRef(issueUrl)}: _${payload.issue.title}_\n\nA member of the team will be in touch to help you get the latest fix 🎉`,
      channel: slack_thread.channel_id,
      thread_ts: slack_thread.slack_thread_ts,
      unfurl_links: false,
      unfurl_media: false,
    })
  }
})

app.shortcut('link_issue', async ({shortcut, ack, client, logger, say}) => {
  await ack();
  const links = shortcut.message.blocks.flatMap(b => b.elements).flatMap(a => a.elements).filter(e => e.type === 'link').map(l => l.url);
  const githubLinkRegex = /https:\/\/github.com\/[^\/]+\/[^\/]+\/issues\/[0-9]+/
  const githubLinks = links.filter(url =>githubLinkRegex.exec(url));
  const threadTs = shortcut.message.thread_ts || shortcut.message_ts;
  const channelId = shortcut.channel.id;
  for await (const githubLink of githubLinks) {
    try {
      await createGithubIssueSlackThread(githubLink, channelId, threadTs);
    }
    catch (e) {
      if ((e.constraint && e.constraint === 'github_issue_slack_threads_pkey')) {
        // do nothing we already subscribed
      }
      else {
        throw e;
      }
    }
  }
  if (githubLinks.length === 0) {
    await say({text: `I couldn't find any github issue links in that message`, thread_ts: threadTs});
  }
  else if (githubLinks.length === 1) {
    const [firstGithubLink] = githubLinks;
    await say({
      text: `I'm keeping an eye on ${renderIssueRef(firstGithubLink)}\n\nI'll notify everyone here as soon as it's fixed!`,
      thread_ts: threadTs,
      unfurl_links: false,
      unfurl_media: false
    });
  }
  else {
    const allIssues = githubLinks.map(renderIssueRef).map(s => `🛠 ${s}`).join('\n')
    await say({
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
