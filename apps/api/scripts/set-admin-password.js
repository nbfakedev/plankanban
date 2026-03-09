const { createClient } = require('./db');
const { hashPassword } = require('../lib/password');

const ADMIN_EMAIL = 'admin@rootwork.ru';
const NEW_PASSWORD = process.argv[2] || process.env.ADMIN_NEW_PASSWORD;

if (!NEW_PASSWORD) {
  console.error('Usage: node set-admin-password.js <password>');
  console.error('   or: ADMIN_NEW_PASSWORD=<password> node set-admin-password.js');
  process.exit(1);
}

async function main() {
  const client = createClient();
  await client.connect();

  try {
    const passwordHash = hashPassword(NEW_PASSWORD);
    const result = await client.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2) RETURNING id, email`,
      [passwordHash, ADMIN_EMAIL]
    );

    if (result.rowCount === 0) {
      console.error('User not found:', ADMIN_EMAIL);
      process.exit(1);
    }

    console.log('Password updated for:', result.rows[0].email);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
