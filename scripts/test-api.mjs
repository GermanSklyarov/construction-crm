import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Retrieve local-only keys in memory. Never log keys, passwords or bearer tokens.
const status = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const api = status.API_URL;
assert(api && ['127.0.0.1', 'localhost'].includes(new URL(api).hostname), 'Local Supabase required');
const publicKey = status.ANON_KEY ?? status.PUBLISHABLE_KEY;
const adminKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
assert(publicKey && adminKey, 'Local CLI keys are required');
const db = new pg.Client({ connectionString: status.DB_URL });
assert(['127.0.0.1', 'localhost'].includes(new URL(status.DB_URL).hostname), 'Local DB required');
const users = [];
const objects = [];
let checks = 0;

async function request(path, { method = 'GET', token, key = publicKey, body } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}
function check(condition, description) {
  assert(condition, description);
  checks++;
  console.log(`PASS: ${description}`);
}
async function provision(role) {
  const email = `crm-test-${randomUUID()}@example.test`;
  const password = `${randomUUID()}Aa9!`;
  const created = await request('/auth/v1/admin/users', {
    method: 'POST', key: adminKey, body: { email, password, email_confirm: true },
  });
  assert.equal(created.status, 200, 'Local test user creation failed');
  const user = { id: created.data.id };
  users.push(user);
  await db.query('insert into public.profiles(id,display_name,role) values ($1,$2,$3)',
    [user.id, 'HTTP test fixture', role]);
  const login = await request('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email, password },
  });
  assert.equal(login.status, 200, 'Password login failed');
  user.token = login.data.access_token;
  return user;
}
try {
  await db.connect();
  const signup = await request('/auth/v1/signup', {
    method: 'POST', body: { email: `signup-${randomUUID()}@example.test`, password: `${randomUUID()}Aa9!` },
  });
  // Track unexpected success for cleanup, then fail the check.
  if (signup.data?.id) users.push({ id: signup.data.id });
  check(signup.status === 422 && signup.data?.error_code === 'signup_disabled', 'Public signup is disabled');
  const manager = await provision('manager');
  const executor = await provision('executor');
  const other = await provision('executor');
  check(true, 'Both roles can sign in with email and password');
  const tasks = [];
  for (const assignee of [executor, other]) {
    const object = await request('/rest/v1/construction_objects', {
      method: 'POST', token: manager.token, body: { name: 'HTTP fixture', address: 'Test address' },
    });
    assert.equal(object.status, 201);
    objects.push(object.data[0].id);
    const task = await request('/rest/v1/tasks', {
      method: 'POST', token: manager.token,
      body: { title: 'HTTP fixture', object_id: object.data[0].id, assignee_id: assignee.id },
    });
    assert.equal(task.status, 201);
    tasks.push(task.data[0].id);
  }
  const [taskA, taskB] = tasks;
  let response = await request(`/rest/v1/tasks?id=in.(${tasks.join(',')})`, { token: executor.token });
  check(response.status === 200 && response.data.length === 1 && response.data[0].id === taskA,
    'Executor REST reads return only assigned task');
  response = await request(`/rest/v1/construction_objects?id=eq.${objects[1]}`, { token: executor.token });
  check(response.status === 200 && response.data.length === 0, 'Foreign object is hidden via REST');
  response = await request(`/rest/v1/tasks?id=eq.${taskB}`, {
    method: 'PATCH', token: executor.token, body: { assignee_id: executor.id },
  });
  check(response.status === 200 && response.data.length === 0, 'REST reassignment attack changes no rows');
  response = await request(`/rest/v1/tasks?id=eq.${taskA}`, {
    method: 'PATCH', token: manager.token, body: { status: 'accepted' },
  });
  check(response.status === 403, 'Even manager cannot PATCH status directly');
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    response = await request(`/rest/v1/task_status_history${method === 'POST' ? '' : `?task_id=eq.${taskA}`}`, {
      method, token: manager.token,
      body: method === 'POST' ? { task_id: taskA, to_status: 'new', actor_id: manager.id }
        : method === 'PATCH' ? { comment: 'forged' } : undefined,
    });
    check(response.status === 403, `History ${method} is denied through REST`);
  }
  response = await request('/rest/v1/rpc/transition_task', {
    method: 'POST', token: other.token,
    body: { p_task_id: taskA, p_expected_status: 'new', p_new_status: 'in_progress' },
  });
  check(response.status === 403, 'RPC denies foreign task transition');
  response = await request('/rest/v1/rpc/transition_task', {
    method: 'POST', token: executor.token,
    body: { p_task_id: taskA, p_expected_status: 'new', p_new_status: 'in_progress' },
  });
  check(response.status === 200, 'Assigned executor can transition via HTTP RPC');
  response = await request(`/rest/v1/task_status_history?task_id=eq.${taskA}&order=id`, { token: executor.token });
  check(response.status === 200 && response.data.length === 2 && response.data[1].actor_id === executor.id,
    'HTTP RPC automatically records real actor in history');
  response = await request(`/rest/v1/tasks?id=eq.${taskA}`, { method: 'DELETE', token: executor.token });
  check(response.status === 200 && response.data.length === 0, 'Executor cannot delete via REST');
  response = await request(`/rest/v1/tasks?id=eq.${taskA}`, { method: 'DELETE', token: manager.token });
  check(response.status === 200 && response.data.length === 1, 'Manager can hard delete via REST');
  const { rows: [{ count }] } = await db.query(
    'select count(*)::int as count from public.task_status_history where task_id=$1', [taskA]);
  check(count === 0, 'REST deletion physically cascades history');
  console.log(`${checks} HTTP checks passed`);
} finally {
  try {
    await db.query('delete from public.tasks where object_id=any($1::uuid[])', [objects]);
    await db.query('delete from public.construction_objects where id=any($1::uuid[])', [objects]);
    await db.query('delete from public.profiles where id=any($1::uuid[])', [users.map(user => user.id)]);
    for (const user of users) {
      const deleted = await request(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE', key: adminKey });
      assert.equal(deleted.status, 200, 'Test Auth user cleanup failed');
    }
  } finally {
    await db.end();
  }
}
