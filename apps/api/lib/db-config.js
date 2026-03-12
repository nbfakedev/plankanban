const { URL } = require('url');

const REQUIRED_PG_ENV_VARS = [
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
];

function isSet(value) {
  return typeof value === 'string' ? value.trim() !== '' : Boolean(value);
}

function getMissingPgEnvVars(env = process.env) {
  return REQUIRED_PG_ENV_VARS.filter((name) => !isSet(env[name]));
}

function toPort(value) {
  if (!isSet(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function createDbConfigFromEnv(env = process.env) {
  const databaseUrl = isSet(env.DATABASE_URL) ? env.DATABASE_URL.trim() : '';
  if (databaseUrl) {
    let connectionString = databaseUrl;
    if (isSet(env.PGHOST)) {
      try {
        const url = new URL(databaseUrl);
        url.hostname = env.PGHOST.trim();
        connectionString = url.toString();
      } catch {
        connectionString = databaseUrl;
      }
    }
    return {
      config: { connectionString },
      source: 'DATABASE_URL',
      missingEnvVars: [],
    };
  }

  return {
    config: {
      host: env.PGHOST,
      port: toPort(env.PGPORT),
      database: env.PGDATABASE,
      user: env.PGUSER,
      password: env.PGPASSWORD,
    },
    source: 'PG_ENV',
    missingEnvVars: getMissingPgEnvVars(env),
  };
}

function createDbConnectionInfo(config) {
  if (config && config.connectionString) {
    try {
      const parsed = new URL(config.connectionString);
      return {
        host: parsed.hostname || undefined,
        port: parsed.port || undefined,
        database: parsed.pathname ? parsed.pathname.replace(/^\//, '') : undefined,
        user: parsed.username || undefined,
      };
    } catch (error) {
      return {
        host: undefined,
        port: undefined,
        database: undefined,
        user: undefined,
        parseError: error.message || 'invalid DATABASE_URL',
      };
    }
  }

  return {
    host: config ? config.host : undefined,
    port: config ? config.port : undefined,
    database: config ? config.database : undefined,
    user: config ? config.user : undefined,
  };
}

module.exports = {
  REQUIRED_PG_ENV_VARS,
  createDbConfigFromEnv,
  createDbConnectionInfo,
  getMissingPgEnvVars,
};
