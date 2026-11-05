import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareDemo } from './demo-data.mjs';

function harness() {
  const accounts = new Map();
  const state = { disk: { users: {} }, authCalls: 0, failAuthAt: 0, failDb: false, ended: false };
  const mutate = ({ email, password }) => {
    state.authCalls++;
    if (state.authCalls === state.failAuthAt) return { error: new Error('Auth unavailable') };
    const user = { id: email, email, password };
    accounts.set(email, user);
    return { data: { user } };
  };
  const admin = { auth: { admin: {
    listUsers: async () => ({ data: { users: [...accounts.values()] } }),
    createUser: async (input) => mutate(input),
    updateUserById: async (id, input) => mutate({ email: id, ...input }),
  } } };
  const db = {
    connect: async () => {},
    query: async () => { if (state.failDb) throw new Error('DB unavailable'); },
    end: async () => { state.ended = true; },
  };
  const run = (saveCredentials = (value) => { state.disk = structuredClone(value); }) =>
    prepareDemo({ admin, db, saved: structuredClone(state.disk), saveCredentials });
  const credentialsMatch = () => {
    for (const user of accounts.values()) {
      const saved = Object.values(state.disk.users).find((u) => u.email === user.email);
      // Never include passwords in assertion diagnostics.
      assert.equal(saved?.password === user.password, true);
    }
  };
  return { state, accounts, run, credentialsMatch };
}

test('database failure preserves usable credentials and retry does not rotate them', async () => {
  const h = harness();
  h.state.failDb = true;
  await assert.rejects(h.run(), /DB unavailable/);
  h.credentialsMatch();
  assert.equal(h.state.ended, true);
  const before = structuredClone(h.state.disk.users);
  h.state.failDb = false;
  await h.run();
  h.credentialsMatch();
  for (const name of Object.keys(before)) assert.equal(before[name].password === h.state.disk.users[name].password, true);
});

test('partial Auth failure is recoverable using the saved intended passwords', async () => {
  const h = harness();
  h.state.failAuthAt = 3;
  await assert.rejects(h.run(), /Auth unavailable/);
  h.credentialsMatch();
  const before = structuredClone(h.state.disk.users);
  h.state.failAuthAt = 0;
  await h.run();
  assert.equal(h.accounts.size, 4);
  h.credentialsMatch();
  for (const name of Object.keys(before)) assert.equal(before[name].password === h.state.disk.users[name].password, true);
});

test('credential storage failure stops before any Auth mutation', async () => {
  const h = harness();
  await assert.rejects(h.run(() => { throw new Error('Disk unavailable'); }), /Disk unavailable/);
  assert.equal(h.state.authCalls, 0);
});
