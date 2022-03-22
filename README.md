Uploading Dashy-bot.mov…

# Dashy - Lightdash little helper

You can run and update our Dashy Slack bot following the next steps.

## Getting started

```bash
# Clone the Lightdash cloud announcer repo
git clone https://github.com/lightdash/lightdash-cloud-announcer.git

```

### Make sure you create and set an `.env` file correctly.


<p>SLACK_SIGNING_SECRET=<a href="https://api.slack.com/apps/A033CLM638C/general?">Find the Signing secret in the app credentials section of this page</a></p>

SLACK_BOT_TOKEN=[Retrieve your token here](https://api.slack.com/apps/A033CLM638C/oauth)

RUDDERSTACK_WRITE_KEY=[Get your Rudderstack write key here](https://app.rudderstack.com/)

RUDDERSTACK_DATA_PLANE_URL=[Get your data plane URL here](https://app.rudderstack.com/)


### Install all dependencies and run the app

```bash
# Install all the project's dependencies
yarn

# Run the app locally
yarn start

# Open another terminal window and Run ngrok
yarn expose
```

### Update events address to test 

In this example we will be testing the `/listblocked` Slack command

Go to the [Slack commands page](https://api.slack.com/apps/A033CLM638C/slash-commands?saved=1) on your Slack settings, choose the command you would like to test and click on the edit button.

![Slack command page](/static/screenshots/slack-command.png)

Once there replace the base url in the `Request URL` field with the last `Forwarding` url that running ngrok returns.

Click save, and try going to a slack channel to test the command. `/listblocked`

You should be able to see the requests coming in the `Web interface` url that running ngrok returns, with all the detailed information of the event. this is very helpful to debug.

> Note: Make sure to install the app into slack workspace whenever you make changes to permissions etc. From the config homepage
