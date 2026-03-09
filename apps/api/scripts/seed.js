const { createClient } = require('./db');
const { hashPassword } = require('../lib/password');

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@rootwork.ru';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'admin123';
const DEFAULT_PROJECT_NAME = process.env.SEED_DEFAULT_PROJECT || 'Default Project';

async function main() {
  const client = createClient();
  await client.connect();

  try {
    await client.query('BEGIN');

    const passwordHash = hashPassword(ADMIN_PASSWORD);
    const adminResult = await client.query(
      `
        INSERT INTO users (email, password_hash, role, status)
        VALUES ($1, $2, 'admin', 'active')
        ON CONFLICT (email)
        DO UPDATE SET
          role = EXCLUDED.role,
          status = EXCLUDED.status,
          updated_at = NOW()
        RETURNING id
      `,
      [ADMIN_EMAIL, passwordHash]
    );
    const adminId = adminResult.rows[0].id;

    const existingProject = await client.query(
      'SELECT id FROM projects WHERE name = $1 LIMIT 1',
      [DEFAULT_PROJECT_NAME]
    );

    if (existingProject.rowCount === 0) {
      await client.query(
        `
          INSERT INTO projects (name, created_by)
          VALUES ($1, $2)
        `,
        [DEFAULT_PROJECT_NAME, adminId]
      );
    }

    await client.query('COMMIT');
    console.log('Seed complete: admin user and default project are ready.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Seed failed:', error.message);
  if (error && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
