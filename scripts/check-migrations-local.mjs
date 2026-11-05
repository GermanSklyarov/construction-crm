// Rehearse a clean application schema transactionally on LOCAL Supabase only.
// Existing schemas/data are restored by ROLLBACK, including on assertion failure.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
const status = JSON.parse(execFileSync('node_modules/.bin/supabase', ['status', '-o', 'json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
if (new URL(status.DB_URL).hostname !== '127.0.0.1') throw Error('Local only');
function transactionBody(sql) {
  // Only remove the checked outer wrapper; never let a migration commit our rehearsal.
  const body = sql.replace(/^begin;\s*/i, '').replace(/\s*commit;\s*$/i, '');
  if (/^\s*(begin|commit|rollback|start\s+transaction)\s*;/im.test(body)) {
    throw Error('Unexpected transaction control');
  }
  return body;
}
const db = new pg.Client({ connectionString: status.DB_URL });
await db.connect();
try {
  await db.query('begin');
  await db.query("set local lock_timeout='3s'; set local statement_timeout='20s'");
  await db.query('drop schema public cascade; drop schema if exists private cascade; create schema public; grant usage on schema public to public');
  for (const name of readdirSync('supabase/migrations').filter(n => n.endsWith('.sql')).sort()) {
    await db.query(transactionBody(readFileSync('supabase/migrations/' + name, 'utf8')));
    console.log('PASS migration:', name);
  }
  const tables = await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'");
  assert.equal(tables.rows.length, 4);
  assert.ok(tables.rows.every(r => r.relrowsecurity));
  assert.equal((await db.query("select has_column_privilege('authenticated','public.tasks','status','UPDATE') allowed")).rows[0].allowed, false);
  assert.equal((await db.query("select has_table_privilege('authenticated','public.task_status_history','INSERT') allowed")).rows[0].allowed, false);
  // Synthetic Auth rows live only inside this rolled-back transaction; no passwords.
  const ids = ['d1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002', 'd1000000-0000-0000-0000-000000000003'];
  for (const id of ids) await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())', [id]);
  let seed = readFileSync('docs/deployment/cloud-demo.sql', 'utf8');
  seed = seed.slice(seed.indexOf('begin;'), seed.lastIndexOf('commit;') + 7);
  for (const [i, token] of ['REPLACE_MANAGER_UUID','REPLACE_EXECUTOR1_UUID','REPLACE_EXECUTOR2_UUID'].entries()) seed = seed.replace(token, ids[i]);
  await db.query(transactionBody(seed));
  assert.deepEqual((await db.query('select status::text from public.tasks order by id')).rows.map(r => r.status), ['new','in_progress','in_review']);
  assert.equal((await db.query('select count(*)::int n from public.task_status_history')).rows[0].n, 6);
  await db.query('savepoint seed_repeat');
  await assert.rejects(db.query(transactionBody(seed)), { code: '23505' });
  await db.query('rollback to savepoint seed_repeat');
  assert.equal((await db.query('select count(*)::int n from public.tasks')).rows[0].n, 3);
  console.log('PASS RLS/grants, cloud demo template and non-destructive repeat rejection');
} finally {
  try { await db.query('rollback'); } finally { await db.end(); }
  console.log('Local rehearsal rolled back; hosted compatibility still needs remote validation');
}
