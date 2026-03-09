const { createClient } = require('./db');
const { hashPassword } = require('../lib/password');

const MASTER_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@rootwork.ru';
const MASTER_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin123';

async function main() {
  const client = createClient();
  await client.connect();

  try {
    await client.query('BEGIN');

    console.log('Cleaning all data...');

    await client.query('DELETE FROM task_chats');
    await client.query('DELETE FROM task_events');
    await client.query('DELETE FROM task_trash');
    await client.query('DELETE FROM import_events');
    await client.query('DELETE FROM import_jobs');
    await client.query('DELETE FROM project_timers');
    await client.query('DELETE FROM user_active_projects');
    await client.query('DELETE FROM tasks');
    await client.query('DELETE FROM llm_requests');
    await client.query('DELETE FROM llm_provider_settings');
    await client.query('DELETE FROM agent_idempotency');
    await client.query('DELETE FROM service_accounts');
    await client.query('DELETE FROM projects');
    await client.query('DELETE FROM users');

    console.log('All data deleted.');

    const passwordHash = hashPassword(MASTER_ADMIN_PASSWORD);
    await client.query(
      `INSERT INTO users (email, password_hash, role, status)
       VALUES ($1, $2, 'admin', 'active')`,
      [MASTER_ADMIN_EMAIL, passwordHash]
    );

    console.log('Master admin recreated: %s', MASTER_ADMIN_EMAIL);

    await client.query('COMMIT');
    console.log('Cleanup complete.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Cleanup failed:', error.message);
  if (error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
