/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const tableName = 'github_issue_slack_threads'
export async function up(knex) {
    if(!(await knex.schema.hasTable(tableName))) {
        await knex.schema.createTable(tableName, tableBuilder => {
            tableBuilder.string('github_issue_url');
            tableBuilder.string('channel_id');
            tableBuilder.string('slack_thread_ts');
            tableBuilder.primary(['github_issue_url', 'channel_id', 'slack_thread_ts']);
        })
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.dropTableIfExists(tableName)
};
