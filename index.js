require('dotenv').config();
const {App} = require('@slack/bolt');
const Analytics = require('@rudderstack/rudder-sdk-node');

const analyticsClient = new Analytics(
    process.env.RUDDERSTACK_WRITE_KEY,
    `${process.env.RUDDERSTACK_DATA_PLANE_URL}/v1/batch`,
);

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
});

app.message(/.*/g, async ({message, say}) => {
    console.log(message);
    analyticsClient.track({
        event: 'slack.message.sent',
        userId: message.user,
        channelId: message.channel,
        channelType: message.channel_type,
        properties: message,
    });
    const isWeekend = new Date(message.ts).getDay() % 6 === 0;
    const messageHours = new Date(message.ts).getUTCHours();
    const isOutOfHours = messageHours < 8 || messageHours > 17;
    if (isWeekend || isOutOfHours) {
        await say(`Hey there <@${message.user}> :wave: The Lightdash team might not be available right now. We will reply as soon as we get back online`);
    }
});

(async () => {
    await app.start(3001)
    console.log('Bolt app running')
})();
