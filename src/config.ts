import { z } from "zod";

const ENV = z.enum(["development", "production"]).default("development").parse(process.env["NODE_ENV"]);

const postgresConnectionString = z.string().parse(process.env["PG_CONNECTION_STRING"]);

const slackConfig = z
  .object({
    signingSecret: z.string(),
    clientId: z.string(),
    clientSecret: z.string(),
    stateSecret: z.string(),
  })
  .parse({
    signingSecret: process.env["SLACK_SIGNING_SECRET"],
    clientId: process.env["SLACK_CLIENT_ID"],
    clientSecret: process.env["SLACK_CLIENT_SECRET"],
    stateSecret: process.env["SLACK_STATE_SECRET"],
  });

const slackAuthorizedTeams = z.string().default("").parse(process.env["SLACK_AUTHORIZED_TEAMS"]).split(",");

const githubWebhooksSecret = z.string().parse(process.env["GITHUB_WEBHOOKS_SECRET"]);

const githubAccessToken = z.string().parse(process.env["GITHUB_ACCESS_TOKEN"]);

const sentryDsn = z.string().optional().parse(process.env["SENTRY_DSN"]);

export {
  ENV,
  postgresConnectionString,
  slackConfig,
  slackAuthorizedTeams,
  githubWebhooksSecret,
  githubAccessToken,
  sentryDsn,
};
