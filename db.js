import Knex from 'knex';
import Knexfile from './knexfile.js';
import {getTeamId} from "./slack.js";

const knex = Knex(Knexfile.production)

// knex.migrate.down();
knex.migrate.latest().then(() => console.log('success migrating')).catch(e => console.error(`Failed migration: ${e}`));

export const createGithubIssueSlackThread = async (githubIssueUrl, slackTeamId, channelId, slackThreadTs) => {
    await knex('github_issue_slack_threads').insert({
        github_issue_url: githubIssueUrl,
        slack_team_id: slackTeamId,
        channel_id: channelId,
        slack_thread_ts: slackThreadTs,
    })
}

export const getSlackThreadsAcrossWorkspaces = async (githubIssueUrl) => {
    const res = await knex.raw(`
        SELECT
          threads.github_issue_url,
          threads.channel_id,
          threads.slack_thread_ts,
          auths.installation->'bot'->'token' as bot_token
        FROM github_issue_slack_threads as threads
        INNER JOIN slack_auth_tokens as auths
          ON threads.slack_team_id = auths.slack_team_id
        WHERE
          threads.github_issue_url = ?`,
        [githubIssueUrl]
    );
    return res.rows;
}

export const createInstallation = async (installation) => {
    const teamId = getTeamId(installation);
    const authorizatedTeamIds = (process.env.SLACK_AUTHORIZED_TEAMS || '').split(',');
    if (!authorizatedTeamIds.includes(teamId)) {
        throw new Error('Not authorized to install Cloudy in this workspace')
    }
    await knex('slack_auth_tokens')
        .insert({
           slack_team_id: teamId,
           installation,
        })
        .onConflict('slack_team_id')
        .ignore();
}

export const getInstallation = async (installQuery) => {
    let teamId;
    if (installQuery.isEnterpriseInstall && installQuery.enterpriseId !== undefined) {
        teamId = installQuery.enterpriseId;
    }
    else if (installQuery.teamId !== undefined) {
        teamId = installQuery.teamId;
    }
    else {
        throw new Error('Could not find a valid team id in the request')
    }
    const [row] = await knex('slack_auth_tokens').select('*').where('slack_team_id', teamId);
    if (row === undefined) {
        throw new Error(`Could not find an installation for team id ${teamId}`);
    }
    return row.installation;
}

export const deleteInstallation = async (installQuery) => {
    let teamId;
    if (installQuery.isEnterpriseInstall && installQuery.enterpriseId !== undefined) {
        teamId = installQuery.enterpriseId;
    }
    else if (installQuery.teamId !== undefined) {
        teamId = installQuery.teamId;
    }
    else {
        throw new Error('Could not find a valid team id in the request')
    }
    await knex('slack_auth_tokens').delete().where('slack_team_id', teamId);
}
