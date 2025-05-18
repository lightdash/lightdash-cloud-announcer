/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const tableName = 'slack_auth_tokens'
export async function up(knex) {
    if(!(await knex.schema.hasTable(tableName))) {
        await knex.schema.createTable(tableName, tableBuilder => {
            tableBuilder.string('slack_team_id').primary();
            tableBuilder.jsonb('installation');
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
