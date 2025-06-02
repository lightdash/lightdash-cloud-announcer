import path from "path";
import { fileURLToPath } from "url";
import { postgresConnectionString } from "../config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envConfig = {
  client: "pg",
  connection: {
    connectionString: postgresConnectionString,
  },
  migrations: {
    tableName: "knex_migrations",
    directory: path.resolve(__dirname, "../db/migrations"),
  },
} as const;

const knexfile = {
  development: envConfig,
  production: envConfig,
} as const;

export default knexfile;
