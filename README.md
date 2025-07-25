# Cloudy - our community helpbot

**Cloudy can query across workspaces. Only install into workspaces you trust. Controlled with `SLACK_AUTHORIZED_TEAMS`**

Cloudy is deployed to prod automatically on push to `main` at https://cloudy-server.onrender.com

You can develop Cloudy locally by following these steps:

## Getting started

```bash
# Clone the Lightdash cloud announcer repo
git clone https://github.com/lightdash/lightdash-cloud-announcer.git
```

### Make sure you create and set an `.env` file correctly.

ℹ️ app id for "dev Cloudy" is `A03NM81NBFD`

SLACK_SIGNING_SECRET=[Get variable from slack app settings](https://api.slack.com/apps/[APP_ID]/general)

SLACK_CLIENT_ID=[Get variable from slack app settings](https://api.slack.com/apps/[APP_ID]/general)

SLACK_CLIENT_SECRET=[Get variable from slack app settings](https://api.slack.com/apps/[APP_ID]/general)

SLACK_STATE_SECRET=this can be anything

SLACK_AUTHORIZED_TEAMS=T0163M87MB9,T03942PB7E3

PG_CONNECTION_STRING=postgres://user:pass@host:port/database

SITE_ENV=https://cloudy-dev-crazy-cayote.loca.lt

GITHUB_WEBHOOKS_SECRET=[Create a new webhook with a secret](https://github.com/organizations/lightdash/settings/hooks)

GITHUB_ACCESS_TOKEN=[Create a new access token](https://github.com/settings/tokens/new)

RUDDERSTACK_WRITE_KEY=[Get your Rudderstack write key here](https://app.rudderstack.com/)

RUDDERSTACK_DATA_PLANE_URL=[Get your data plane URL here](https://app.rudderstack.com/)

## Setup dev

### 1. Install all dependencies

```bash
# Install all the project's dependencies
npm install

# Run the app locally
npm run dev

# build and start
npm run build && npm start
```

### 2. Run cloudflared and update URLs

[read more on cloudflared and custom lightdash.dev domains here](https://www.notion.so/lightdash/Generate-public-development-URLs-with-cloudflared-tunnel-proxy-13fa63207a7a800d8029e8fd36499752)

```bash
npm expose irakli # exposes irakli.lightdash.dev domain
```

Now you need to update the URLs with the cloudflared URL:

- Update the `SITE_ENV` environment variable
- Update all domains in the `/slack-app-manifest.json`

### 3. Configure slack to use our app

- Create or update a slack app at `https://api.slack.com`
- Copy in the `slack-app-manifest.json` (change command names and bot name if in dev)
- Get all the secrets from the "basic information" and update:
  - `SLACK_SIGNING_SECRET`
  - `SLACK_CLIENT_ID`
  - `SLACK_CLIENT_SECRET`

### 4. Setup GitHub webhooks

Go to webhooks and create a new webhook

- Payload URL `https://[ngrok domain]/api/github/webhooks`
- Content type: `application/json`
- Add a secret variable (it can be anything)
- Enable SSL
- "Let me select individual events" -> `Issues` only
- Active ✔️

In the app add the following variables:

```
GITHUB_WEBHOOKS_SECRET=the secret you chose above (it can be anything but must match the one you provided to github)
GITHUB_ACCESS_TOKEN=a personal access token for GitHub
```

### 6. Run the app locally

```shell
npm run dev
```

### 7. Verify webhooks

Once the app is running, in your webhook settings in GitHub verify that you can receive the ping event:

![CleanShot 2023-11-29 at 19 00 12@2x](https://github.com/lightdash/lightdash-cloud-announcer/assets/11660098/195add17-9e6e-46c3-8483-9598aa0b619c)

In Slack under "event subscriptions" check you can receive the ping event:

![CleanShot 2023-11-29 at 19 01 51@2x](https://github.com/lightdash/lightdash-cloud-announcer/assets/11660098/87c3b8f8-9a7e-4fd4-ad74-2c3bc0f832ae)

### 8. Install into your workspace

visit https://yourdomain.com/slack/install

:info: installing from the slack app settings won't work.

### Production

- Update all URLs for prod deployment
- Under "manage distribution" set to "publicly available"

### Dev notes

#### Add migration

```shell
npm knex -- migrate:make <migration_name> --env production
```
