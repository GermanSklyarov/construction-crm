import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

// Deliberately local-only: fixtures are committed across connections, then removed.
const connectionString = process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const url = new URL(connectionString);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local test database required');
const clients = Array.from({ length: 3 }, () => new pg.Client({ connectionString }));
const [admin, first, second] = clients;
const manager = randomUUID();
const executor = randomUUID();
const otherExecutor = randomUUID();
const object = randomUUID();
const task = randomUUID();
let pending;

async function asUser(client, uid) {
  await client.query('begin');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
  await client.query('set local role authenticated');
  await client.query("set local statement_timeout = '10s'");
}

async function waitUntilBlocked(pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await admin.query('select cardinality(pg_blocking_pids($1)) > 0 as blocked', [pid]);
    if (rows[0].blocked) return;
    await delay(25);
  }
  throw new Error('Competing query did not wait for the row lock');
}

const transition = (client) => client.query(
  "select public.transition_task($1, 'new', 'in_progress')", [task],
);
const outcome = (promise) => promise.then(() => ({ code: 'SUCCESS' }), error => ({ code: error.code }));

try {
  await Promise.all(clients.map(client => client.connect()));
  const { rows: [{ pid }] } = await second.query('select pg_backend_pid() as pid');
  await admin.query('begin');
  await admin.query('insert into auth.users(id) values ($1),($2),($3)', [manager, executor, otherExecutor]);
  await admin.query(`insert into public.profiles(id,display_name,role)
    values ($1,'Race manager','manager'),($2,'Race A','executor'),($3,'Race B','executor')`,
  [manager, executor, otherExecutor]);
  await admin.query('insert into public.construction_objects(id,name,address) values ($1,$2,$3)',
    [object, 'Concurrency fixture', 'Test only']);
  await admin.query("select set_config('request.jwt.claim.sub', $1, true)", [manager]);
  await admin.query('insert into public.tasks(id,title,object_id,assignee_id) values ($1,$2,$3,$4)',
    [task, 'Concurrency fixture', object, executor]);
  await admin.query('commit');

  await asUser(first, executor);
  await asUser(second, executor);
  await transition(first);
  pending = outcome(transition(second));
  await waitUntilBlocked(pid);
  await first.query('commit');
  assert.equal((await pending).code, '40001');
  await second.query('rollback');
  const { rows: [result] } = await admin.query(`select status,
    (select count(*)::int from public.task_status_history where task_id=$1) as history_count
    from public.tasks where id=$1`, [task]);
  assert.deepEqual(result, { status: 'in_progress', history_count: 2 });
  console.log('PASS: concurrent identical transitions yield one success, one conflict, one new history row');

  // Owner resets status solely to prepare an independent race scenario.
  await admin.query("update public.tasks set status='new' where id=$1", [task]);
  await asUser(first, manager);
  await first.query('update public.tasks set assignee_id=$1 where id=$2', [otherExecutor, task]);
  await asUser(second, executor);
  pending = outcome(transition(second));
  await waitUntilBlocked(pid);
  await first.query('commit');
  assert.equal((await pending).code, '42501');
  await second.query('rollback');
  console.log('PASS: concurrent reassignment revokes former executor transition permission');

  await asUser(first, manager);
  await first.query('delete from public.tasks where id=$1', [task]);
  await asUser(second, otherExecutor);
  pending = outcome(transition(second));
  await waitUntilBlocked(pid);
  await first.query('commit');
  assert.equal((await pending).code, '42501');
  await second.query('rollback');
  const { rows: [{ count }] } = await admin.query(
    'select count(*)::int as count from public.task_status_history where task_id=$1', [task]);
  assert.equal(count, 0);
  console.log('PASS: concurrent deletion rejects transition and cascades all history');
} finally {
  await Promise.allSettled([first.query('rollback'), second.query('rollback'), admin.query('rollback')]);
  if (pending) await pending;
  try {
    await admin.query('begin');
    await admin.query('delete from public.tasks where id=$1', [task]);
    await admin.query('delete from public.construction_objects where id=$1', [object]);
    await admin.query('delete from public.profiles where id=any($1::uuid[])', [[manager, executor, otherExecutor]]);
    await admin.query('delete from auth.users where id=any($1::uuid[])', [[manager, executor, otherExecutor]]);
    await admin.query('commit');
  } finally {
    await Promise.allSettled(clients.map(client => client.end()));
  }
}
