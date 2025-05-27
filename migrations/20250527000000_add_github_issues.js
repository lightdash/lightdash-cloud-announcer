/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const GithubIssuesTableName = 'github_issues';

export async function up(knex) {
    await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');

    await knex.schema.createTable(GithubIssuesTableName, table => {
        table.increments('id');
        table.string('owner').notNullable();
        table.string('repo').notNullable();
        table.integer('issue_id').notNullable();
        table.string('issue_url').notNullable();
        table.string('type').notNullable();
        table.text('title').notNullable();
        table.text('description');
        table.specificType('labels', 'text[]');
        table.string('milestone');
        table.string('status');
        table.specificType('embeddings', 'vector').notNullable();

        table.unique(['owner', 'repo', 'issue_id']);
    });

}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export async function down(knex) {
    await knex.schema.dropTableIfExists(GithubIssuesTableName);

    await knex.raw('DROP EXTENSION IF EXISTS vector');
}