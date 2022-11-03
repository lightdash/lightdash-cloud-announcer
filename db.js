import Knex from 'knex';
import Knexfile from './knexfile.js';
import {getTeamId} from "./slack.js";

const knex = Knex(Knexfile.production)

// knex.migrate.down();
knex.migrate.latest().then(() => console.log('success migrating')).catch(e => console.error(`Failed migration: ${e}`));

/**
 * @param { string } channelId
 * @returns { Promise<string> }
 */
export const totalOpenIssueCountInChannel = async (channelId) => {
    const [ { count } ] = await knex('github_issue_slack_threads')
        .countDistinct('github_issue_url')
        .where('channel_id', channelId)
        .andWhereRaw('is_closed is false');
    return count
}

/**
 *
 * @param {string} githubIssueUrl
 * @param {boolean} isClosed
 * @returns {Promise<void>}
 */
export const setIssueIsClosed = async (githubIssueUrl, isClosed) => {
    await knex('github_issue_slack_threads')
        .where('github_issue_url', githubIssueUrl)
        .update({'is_closed': isClosed});
}

export const createGithubIssueSlackThread = async (githubIssueUrl, slackTeamId, channelId, slackThreadTs, isClosed) => {
    await knex('github_issue_slack_threads').insert({
        github_issue_url: githubIssueUrl,
        slack_team_id: slackTeamId,
        channel_id: channelId,
        slack_thread_ts: slackThreadTs,
        is_closed: isClosed,
    }).onConflict(['github_issue_url', 'slack_team_id', 'channel_id', 'slack_thread_ts']).merge();
}

export const getIssueThreadsFromIssue = async (githubIssueUrl) => {
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

export const countAllOpenIssues = async () => {
    const res = await knex.raw(`
        SELECT
          threads.github_issue_url,
          COUNT(*) as count
        FROM github_issue_slack_threads as threads
        WHERE
            threads.is_closed is false
        GROUP BY 1
        ORDER BY 2 desc`
    );
    return res.rows;
}

export const countAllOpenIssuesInChannel = async (channelId) => {
    const res = await knex.raw(`
        SELECT
          threads.github_issue_url,
          COUNT(*) as count
        FROM github_issue_slack_threads as threads
        WHERE
            threads.channel_id = ?
        AND
            threads.is_closed is false
        GROUP BY 1
        ORDER BY 2 desc`,
        [channelId]
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
