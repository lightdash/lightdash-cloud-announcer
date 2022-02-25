const { App } = require('@slack/bolt');
const Analytics = require('@rudderstack/rudder-sdk-node');

const identifiedUsers = {}

const analyticsClient = new Analytics(
    process.env.RUDDERSTACK_WRITE_KEY,
    `${process.env.RUDDERSTACK_DATAPLANE_URL}/v1/batch`,
);

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});

app.message('', async ({ message, say }) => {
    await say(`Hey there <@${message.user}>`);
    analyticsClient.track({
        event: 'slack.message.sent',
        userId: message.user,
        properties: message,
    });
});

(async () => {
    await app.start(3001)
    console.log('Bolt app running')
})();
