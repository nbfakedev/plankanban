const crypto = require('crypto');

const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedValue) {
  const parts = String(storedValue || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }

  const salt = parts[1];
  const expectedHashHex = parts[2];

  if (!salt || !expectedHashHex) {
    return false;
  }

  try {
    const computedHashHex = crypto
      .scryptSync(password, salt, KEY_LENGTH)
      .toString('hex');
    const expected = Buffer.from(expectedHashHex, 'hex');
    const actual = Buffer.from(computedHashHex, 'hex');

    if (expected.length === 0 || expected.length !== actual.length) {
      return false;
    }

    return crypto.timingSafeEqual(expected, actual);
  } catch (_) {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
};
