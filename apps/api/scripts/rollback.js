const fs = require('fs');
const path = require('path');
const { createClient } = require('./db');

const migrationsDir = path.resolve(__dirname, '..', 'migrations');

function getDownPath(migrationName) {
  return path.join(migrationsDir, `${migrationName}.down.sql`);
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function main() {
  const client = createClient();
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const last = await client.query(`
      SELECT name
      FROM schema_migrations
      ORDER BY applied_at DESC, name DESC
      LIMIT 1
    `);

    if (last.rowCount === 0) {
      console.log('No applied migrations to roll back.');
      return;
    }

    const migrationName = last.rows[0].name;
    const downPath = getDownPath(migrationName);

    if (!fs.existsSync(downPath)) {
      throw new Error(`Down migration file not found: ${downPath}`);
    }

    const sql = fs.readFileSync(downPath, 'utf8');

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE name = $1', [
        migrationName,
      ]);
      await client.query('COMMIT');
      console.log(`Rolled back migration: ${migrationName}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Rollback failed:', error.message);
  process.exit(1);
});
