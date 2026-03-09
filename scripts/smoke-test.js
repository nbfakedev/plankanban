#!/usr/bin/env node
/**
 * Smoke test: health + auth login (no DB required for health).
 * Usage: node scripts/smoke-test.js [baseUrl]
 * Example: node scripts/smoke-test.js http://localhost:3000
 */
const baseUrl = process.argv[2] || 'http://localhost:3000';

async function get(path) {
  const res = await fetch(baseUrl + path, { method: 'GET' });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

async function post(path, body) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, ok: res.ok, body: await res.text() };
}

async function main() {
  const checks = [];
  let ok = 0;

  try {
    const health = await get('/health');
    const healthOk = health.ok && health.body.includes('ok');
    checks.push({ name: 'GET /health', ok: healthOk, status: health.status });
    if (healthOk) ok++;

    const login = await post('/auth/login', { email: 'admin@local.dev', password: 'admin123' });
    let loginOk = login.ok;
    let token = null;
    if (login.ok) {
      try {
        const data = JSON.parse(login.body);
        token = data.token;
        loginOk = !!token;
      } catch (_) {
        loginOk = false;
      }
    }
    const loginReachable = login.status === 200 || login.status === 401;
    checks.push({ name: 'POST /auth/login', ok: loginOk, status: login.status });
    if (loginOk) ok++;
    else if (loginReachable) checks[checks.length - 1].note = '(endpoint OK, wrong credentials)';

    if (token) {
      const me = await fetch(baseUrl + '/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const meOk = me.ok;
      checks.push({ name: 'GET /auth/me', ok: meOk, status: me.status });
      if (meOk) ok++;

      const projects = await fetch(baseUrl + '/projects', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const projOk = projects.ok;
      checks.push({ name: 'GET /projects', ok: projOk, status: projects.status });
      if (projOk) ok++;
    }
  } catch (e) {
    checks.push({ name: 'Request', ok: false, error: e.message });
  }

  console.log('Smoke test:', baseUrl);
  checks.forEach((c) => {
    const s = c.ok ? 'OK' : 'FAIL';
    console.log('  ', s, c.name, c.status != null ? '(' + c.status + ')' : '', c.error || '', c.note || '');
  });
  const healthOk = checks[0] && checks[0].ok;
  console.log('Result:', ok + '/' + checks.length, healthOk ? '- server up' : '');
  process.exit(healthOk ? 0 : 1);
}

main();
