const { Client } = require('pg');

function createClient() {
  const hasConnectionInfo =
    Boolean(process.env.DATABASE_URL) || Boolean(process.env.PGHOST);

  if (!hasConnectionInfo) {
    throw new Error(
      'Database connection is not configured. Set DATABASE_URL or PG* env vars.'
    );
  }

  return new Client({
    connectionString: process.env.DATABASE_URL || undefined,
  });
}

module.exports = {
  createClient,
};
