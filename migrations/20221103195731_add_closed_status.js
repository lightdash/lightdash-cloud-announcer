/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    if((await knex.schema.hasTable('github_issue_slack_threads'))) {
        await knex.schema.alterTable('github_issue_slack_threads', tableBuilder => {
            tableBuilder.boolean('is_closed').nullable();
        })
    }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    if((await knex.schema.hasTable('github_issue_slack_threads'))) {
        await knex.schema.alterTable('github_issue_slack_threads', tableBuilder => {
            tableBuilder.dropColumn('is_closed');
        })
    }
}
