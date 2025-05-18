import { Webhooks } from "@octokit/webhooks";
import bolt from "@slack/bolt";
import { Octokit } from "octokit";
import manifest from "../slack-app-manifest.json" with { type: "json" };
import { ENV, githubAccessToken, githubWebhooksSecret, slackConfig } from "./config.js";
import { deleteInstallation, fetchInstallation, storeInstallation } from "./db.js";

const { App, ExpressReceiver, LogLevel } = bolt;

export const expressReceiver = new ExpressReceiver({
  ...slackConfig,
  scopes: manifest.oauth_config.scopes.bot,
  installationStore: { storeInstallation, fetchInstallation, deleteInstallation },
});

export const slackApp = new App({
  receiver: expressReceiver,
  logLevel: ENV === "development" ? LogLevel.DEBUG : LogLevel.INFO,
});

export const octokitClient = new Octokit({
  auth: githubAccessToken,
});

export const githubWebhooks = new Webhooks({
  secret: githubWebhooksSecret,
});
