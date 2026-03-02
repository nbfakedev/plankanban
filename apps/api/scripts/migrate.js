const fs = require('fs');
const path = require('path');
const { createClient } = require('./db');

const migrationsDir = path.resolve(__dirname, '..', 'migrations');

function getUpMigrations() {
  return fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.up.sql'))
    .sort();
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function applyMigration(client, fileName) {
  const migrationName = fileName.replace(/\.up\.sql$/, '');
  const upPath = path.join(migrationsDir, fileName);
  const sql = fs.readFileSync(upPath, 'utf8');

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (name) VALUES ($1)',
      [migrationName]
    );
    await client.query('COMMIT');
    console.log(`Applied migration: ${migrationName}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const client = createClient();
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const applied = await client.query('SELECT name FROM schema_migrations');
    const appliedSet = new Set(applied.rows.map((row) => row.name));
    const migrations = getUpMigrations();

    for (const fileName of migrations) {
      const migrationName = fileName.replace(/\.up\.sql$/, '');
      if (appliedSet.has(migrationName)) {
        continue;
      }
      await applyMigration(client, fileName);
    }

    console.log('Migrations are up to date.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  if (error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
