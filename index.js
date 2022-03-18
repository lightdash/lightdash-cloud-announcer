require('dotenv').config();
const {App} = require('@slack/bolt');
const Analytics = require('@rudderstack/rudder-sdk-node');

const CLOUD_ANNOUNCER_CHANNEL_ID = 'C037H6ZCSK0';

const analyticsClient = new Analytics(
    process.env.RUDDERSTACK_WRITE_KEY,
    `${process.env.RUDDERSTACK_DATA_PLANE_URL}/v1/batch`,
);

const app = new App({
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    token: process.env.SLACK_BOT_TOKEN,
});

app.message(/.*/g, async ({message, say, logger}) => {
    try {
        if (message.channel_id !== CLOUD_ANNOUNCER_CHANNEL_ID) {
            analyticsClient.track({
                event: 'slack.message.sent',
                userId: message.user,
                properties: message,
            });
            const isWeekend = new Date(message.ts).getDay() % 6 === 0;
            const messageHours = new Date(message.ts).getUTCHours();
            const isOutOfHours = messageHours < 8 || messageHours > 17;
            if (isWeekend || isOutOfHours) {
                await say(`Hey there <@${message.user}> :wave: The Lightdash team might not be available right now. We will reply as soon as we get back online`);
            }
        }
    } catch (e) {
        console.log(e);
    }
});

app.command('/broadcastcloudmessage', async ({command, ack, respond}) => {
    await ack();
    if (command.channel_id === CLOUD_ANNOUNCER_CHANNEL_ID) {
        analyticsClient.track({
            event: 'dashy.broadcast.sent',
            userId: command.user_id,
            properties: command,
        });
        await respond(`I'm broadcasting your message. *_woof_ _woof_*`);

        const conversations = await app.client.users.conversations();

        conversations.channels.forEach(channel => {
            if (channel.id !== CLOUD_ANNOUNCER_CHANNEL_ID) {
                app.client.chat.postMessage({
                    channel: channel.id,
                    text: command.text
                });
            }
        });
    } else {
        await respond(`This command is not available in this channel`);
    }
});

app.command('/previewbroadcastcloudmessage', async ({command, say, ack, respond}) => {    //Ignore the :any if you're not using Typescript
    await ack();
    if (command.channel_id === CLOUD_ANNOUNCER_CHANNEL_ID) {
        await say(`Preview *${command.user_name}'s* broadcast message:\n ======================================`);
        await say(command.text)
    } else {
        await respond(`This command is not available in this channel`);
    }
});

const blockedChannels = {};

app.command('/markblocked', async ({command, say, ack, respond}) => {    //Ignore the :any if you're not using Typescript
    await ack();
    if (command.channel_id !== CLOUD_ANNOUNCER_CHANNEL_ID) {
        blockedChannels[command.channel_id] = command;
        await respond(`Channel *${command.channel_name}* has been marked as blocked`);
    } else {
        await respond(`This command is not available in this channel`);
    }
});

app.command('/markunblocked', async ({command, say, ack, respond}) => {    //Ignore the :any if you're not using Typescript
    await ack();
    if (command.channel_id !== CLOUD_ANNOUNCER_CHANNEL_ID) {
        delete blockedChannels[command.channel_id];
        await respond(`Channel *${command.channel_name}* has been removed as blocked`);
    } else {
        await respond(`This command is not available in this channel`);
    }
});

app.command('/listblocked', async ({command, say, ack, respond}) => {    //Ignore the :any if you're not using Typescript
    await ack();
    if (command.channel_id === CLOUD_ANNOUNCER_CHANNEL_ID) {
        if (Object.values(blockedChannels).length <= 0) {
            await respond(`No blocked users`);
        } else {
            await respond(`Blocked channels:\n ${Object.values(blockedChannels).map(blockedCommand => `<#${blockedCommand.channel_id}>`).join('\n')}`);
        }
    } else {
        await respond(`This command is not available in this channel`);
    }
});

(async () => {
    await app.start(3001)
    console.log('Bolt app running on localhost:3001')
})();
