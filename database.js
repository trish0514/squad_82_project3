const { Pool } = require('pg');
require('dotenv').config(); // Loads your variables from the .env file

const pool = new Pool({
  host: process.env.PSQL_HOST,
  user: process.env.PSQL_USER,
  database: process.env.PSQL_DATABASE,
  password: process.env.PSQL_PASSWORD,
  port: process.env.PSQL_PORT || 5432,
  ssl: {
    rejectUnauthorized: false // Required for Render or external connections
  }
});

module.exports = pool;
