import Bolt from "@slack/bolt";
import manifest from "../../slack-app-manifest.json" with { type: "json" };
import { ENV, slackConfig } from "../config.js";
import { deleteInstallation, fetchInstallation, storeInstallation } from "../db/db.js";

const { App, ExpressReceiver, LogLevel } = Bolt;

export const expressReceiver = new ExpressReceiver({
  ...slackConfig,
  scopes: manifest.oauth_config.scopes.bot,
  installationStore: {
    storeInstallation,
    fetchInstallation,
    deleteInstallation,
  },
});

export const slackApp = new App({
  receiver: expressReceiver,
  logLevel: ENV === "development" ? LogLevel.DEBUG : LogLevel.INFO,
});
