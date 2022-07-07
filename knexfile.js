// Update with your config settings.
export const production = {
  client: 'pg',
  connection: {
    connectionString: process.env.PG_CONNECTION_STRING,
  },
  migrations: {
    tableName: 'knex_migrations',
  }
}
