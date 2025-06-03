import { Webhooks } from "@octokit/webhooks";
import { Octokit } from "octokit";
import { githubAccessToken, githubWebhooksSecret } from "../config.js";

export const octokitClient = new Octokit({
  auth: githubAccessToken,
});

export const githubWebhooks = new Webhooks({
  secret: githubWebhooksSecret,
});
