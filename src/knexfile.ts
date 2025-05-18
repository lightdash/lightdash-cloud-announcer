import Knex from "knex";
import { ENV, postgresConnectionString } from "./config.js";

const envConfig = {
  client: "pg",
  connection: {
    connectionString: postgresConnectionString,
  },
  migrations: {
    tableName: "knex_migrations",
    directory: "migrations",
  },
} as const;

const knexfile = {
  development: envConfig,
  production: envConfig,
} as const;

export default knexfile;

const config = knexfile[ENV];

export const knex = Knex(config);
