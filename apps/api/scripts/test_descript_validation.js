const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@local.dev';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TOO_LONG = 'x'.repeat(5001);

async function requestJson(method, path, body, token) {
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }

  return { status: response.status, json, text };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getAdminToken() {
  const response = await requestJson('POST', '/auth/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  assert(response.status === 200, `login failed: ${response.status} ${response.text}`);
  assert(response.json && response.json.token, 'login response has no token');
  return response.json.token;
}

async function resolveProjectId(token) {
  const projectsResp = await requestJson('GET', '/projects', undefined, token);
  assert(projectsResp.status === 200, `GET /projects failed: ${projectsResp.status}`);

  if (projectsResp.json && Array.isArray(projectsResp.json.projects) && projectsResp.json.projects.length > 0) {
    return projectsResp.json.projects[0].id;
  }

  const createResp = await requestJson(
    'POST',
    '/projects',
    { name: 'Descript Validation Test Project' },
    token
  );
  assert(createResp.status === 201, `POST /projects failed: ${createResp.status} ${createResp.text}`);
  assert(createResp.json && createResp.json.project && createResp.json.project.id, 'project id is missing');
  return createResp.json.project.id;
}

async function run() {
  const token = await getAdminToken();
  const projectId = await resolveProjectId(token);

  const createValid = await requestJson(
    'POST',
    `/projects/${projectId}/tasks`,
    { title: 'descript-valid', descript: 'ok' },
    token
  );
  assert(createValid.status === 201, `valid create failed: ${createValid.status} ${createValid.text}`);
  const taskId = createValid.json.task.id;

  const createTooLong = await requestJson(
    'POST',
    `/projects/${projectId}/tasks`,
    { title: 'descript-too-long-create', descript: TOO_LONG },
    token
  );
  assert(createTooLong.status === 400, `too-long create should be 400, got ${createTooLong.status}`);

  const updateValid = await requestJson(
    'PATCH',
    `/tasks/${taskId}`,
    { descript: 'updated' },
    token
  );
  assert(updateValid.status === 200, `valid update failed: ${updateValid.status} ${updateValid.text}`);
  assert(updateValid.json.task.descript === 'updated', 'valid update did not persist descript');

  const updateTooLong = await requestJson(
    'PATCH',
    `/tasks/${taskId}`,
    { descript: TOO_LONG },
    token
  );
  assert(updateTooLong.status === 400, `too-long update should be 400, got ${updateTooLong.status}`);

  console.log('PASS: create valid descript');
  console.log('PASS: create too-long descript returns 400');
  console.log('PASS: update descript');
  console.log('PASS: update too-long descript returns 400');
}

run().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
