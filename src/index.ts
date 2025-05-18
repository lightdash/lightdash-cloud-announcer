import { createNodeMiddleware } from "@octokit/webhooks";
import * as Sentry from "@sentry/node";
import { expressReceiver, githubWebhooks, slackApp } from "./clients.js";
import { sentryDsn } from "./config.js";
import initGithubWebhooks from "./github.js";
import initSlackApp from "./slack.js";

if (sentryDsn) Sentry.init({ dsn: sentryDsn });

expressReceiver.app.use(createNodeMiddleware(githubWebhooks));
expressReceiver.app.get("/healthz", (_, res) => {
  res.status(200).send();
});

initSlackApp(slackApp);
initGithubWebhooks(githubWebhooks);

Sentry.setupExpressErrorHandler(expressReceiver.app);
await slackApp.start(3001);

console.info("[BOLT] App running on localhost:3001");
