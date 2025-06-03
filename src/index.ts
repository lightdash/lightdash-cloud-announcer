import { createNodeMiddleware } from "@octokit/webhooks";
import * as Sentry from "@sentry/node";
import { githubWebhooks } from "./clients/github.js";
import { expressReceiver, slackApp } from "./clients/slack.js";
import { sentryDsn } from "./config.js";
import { knex } from "./db/db.js";
import initGithubWebhooks from "./github.js";
import initSlackApp from "./slack.js";

if (sentryDsn) Sentry.init({ dsn: sentryDsn });

expressReceiver.app.use(createNodeMiddleware(githubWebhooks));
expressReceiver.app.get("/healthz", (_, res) => {
  res.status(200).send();
});

initSlackApp(slackApp);
initGithubWebhooks(githubWebhooks);

knex.migrate
  .latest()
  .then(() => console.info("[KNEX] Success migrating"))
  .catch((e) => {
    console.error("[KNEX] Migration failed");
    console.error(e);
    process.exit(1);
  });

Sentry.setupExpressErrorHandler(expressReceiver.app);
await slackApp.start(3001);
console.info("[BOLT] App running on localhost:3001");
