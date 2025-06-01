import type { Knex } from "knex";

declare module "knex/types/tables.js" {
  interface FirstResponder {
    id: number;
    slack_team_id: string;
    slack_user_id: string;
    started_at: Date;
  }

  interface SlackAuthToken<T extends { bot: { token: string } }> {
    slack_team_id: string;
    installation: T;
  }

  interface GithubIssueSlackThread {
    github_issue_url: string;
    channel_id: string;
    slack_thread_ts: string;
    slack_team_id: string;
    is_closed: boolean | null;
  }

  interface GithubIssue {
    id: number;
    owner: string;
    repo: string;
    issue_id: number;
    issue_url: string;
    type: string;
    title: string;
    description: string | null;
    labels: string[] | null;
    milestone: string | null;
    status: string | null;
    embeddings: string | null;
  }

  interface Tables {
    first_responders: Knex.CompositeTableType<FirstResponder, Omit<FirstResponder, "id" | "started_at">>;
    slack_auth_tokens: Knex.CompositeTableType<SlackAuthToken>;
    github_issue_slack_threads: Knex.CompositeTableType<GithubIssueSlackThread>;
    github_issues: Knex.CompositeTableType<GithubIssue, Omit<GithubIssue, "id">, Partial<Omit<GithubIssue, "id">>>;
  }
}
