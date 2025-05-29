/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function up(knex) {
    await knex.schema.createTable('first_responders', tableBuilder => {
        tableBuilder.increments('id');
        tableBuilder.string('slack_team_id');
        tableBuilder.string('slack_user_id');
        tableBuilder.timestamp('started_at').defaultTo(knex.fn.now());
        tableBuilder.index(['slack_team_id', 'slack_user_id']);
        tableBuilder.index(['slack_team_id', 'started_at']);
    });
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.dropTableIfExists('first_responders');
} 