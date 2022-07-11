// Update with your config settings.
const knexfile = {
  production: {
    client: 'pg',
        connection: {
    connectionString: process.env.PG_CONNECTION_STRING,
  },
    migrations: {
      tableName: 'knex_migrations',
    }
  }
}

export default knexfile;
