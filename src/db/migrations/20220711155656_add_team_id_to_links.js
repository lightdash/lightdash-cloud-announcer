const OUR_TEAM_ID = 'T0163M87MB9'
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    if((await knex.schema.hasTable('github_issue_slack_threads'))) {
        await knex.schema.alterTable('github_issue_slack_threads', tableBuilder => {
            tableBuilder.string('slack_team_id').defaultTo(OUR_TEAM_ID);
            tableBuilder.dropPrimary();
            tableBuilder.primary(['github_issue_url', 'slack_team_id', 'channel_id', 'slack_thread_ts']);
            tableBuilder.string('slack_team_id').alter(); // drop default
        })
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    if((await knex.schema.hasTable('github_issue_slack_threads'))) {
        await knex.schema.alterTable('slack_auth_tokens', tableBuilder => {
            tableBuilder.dropColumn('slack_team_id');
        })
    }
};
