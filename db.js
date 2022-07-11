import Knex from 'knex';
import { production } from './knexfile.js';

const knex = Knex(production)

// knex.migrate.down();
knex.migrate.latest().then(() => console.log('success migrating')).catch(e => console.error(`Failed migration: ${e}`));

export const createGithubIssueSlackThread = async (githubIssueUrl, channelId, slackThreadTs) => {
    await knex('github_issue_slack_threads').insert({
        github_issue_url: githubIssueUrl,
        channel_id: channelId,
        slack_thread_ts: slackThreadTs,
    })
}

export const getSlackThreads = async (githubIssueUrl) => {
    return knex('github_issue_slack_threads').select('*').where('github_issue_url', githubIssueUrl);
}
