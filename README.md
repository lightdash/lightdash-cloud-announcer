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


SLACK_SIGNING_SECRET=[Get variable from slack app settings](https://api.slack.com/apps/A033CLM638C/general)

SLACK_CLIENT_ID=[Get variable from slack app settings](https://api.slack.com/apps/A033CLM638C/general)

SLACK_CLIENT_SECRET=[Get variable from slack app settings](https://api.slack.com/apps/A033CLM638C/general)

SLACK_STATE_SECRET=this can be anything

SLACK_AUTHORIzED_TEAMS=T0163M87MB9,T03942PB7E3

PG_CONNECTION_STRING=postgres://user:pass@host:port/database

SITE_ENV=https://domain.where.app.hosted.com

GITHUB_WEBHOOKS_SECRET=[Create a new webhook with a secret](https://github.com/organizations/lightdash/settings/hooks)

GITHUB_ACCESS_TOKEN=[Create a new access token](https://github.com/settings/tokens/new)

RUDDERSTACK_WRITE_KEY=[Get your Rudderstack write key here](https://app.rudderstack.com/)

RUDDERSTACK_DATA_PLANE_URL=[Get your data plane URL here](https://app.rudderstack.com/)

## Setup dev

### 1. Install all dependencies

```bash
# Install all the project's dependencies
yarn

# Run the app locally
yarn start
```

### 2. Run ngrok and update URLs
```shell
yarn expose
```

Now you need to update the following URLs with the last `Forwarding` url that ngrok returns:

* Update the `SITE_ENV` environment variable
* Update all domains in the `/slack-app-manifest.yaml`

### 3. Configure slack to use our app

* Create or update a slack app at `https://api.slack.com`
* Copy in the `slack-app-manifest.yaml` (change command names and bot name if in dev)
* Get all the secrets from the "basic information" and update:
  * `SLACK_SIGNING_SECRET`
  * `SLACK_CLIENT_ID`
  * `SLACK_CLIENT_SECRET`

### 4. Run the app locally

```shell
yarn dev
```

### 5. Install into your workspace

Visit `https://[ngrok domain]/slack/oauth_redirect` to install the app correctly. This won't work through the api.
slack.com web UI. 

### Production 

* Update all URLs for prod deployment
* Under "manage distribution" set to "publicly available"

### Dev notes

#### Add migration

```shell
yarn knex migrate:make <migration_name> --env production
```
