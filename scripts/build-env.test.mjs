import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBuildEnv } from './check-build-env.mjs';
const env = { VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' };
test('hosted public configuration is accepted', () => assert.doesNotThrow(() => validateBuildEnv(env, true)));
test('missing environment is rejected', () => assert.throws(() => validateBuildEnv({})));
test('localhost is allowed locally but rejected on Vercel', () => {
  const local = { ...env, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' };
  assert.doesNotThrow(() => validateBuildEnv(local));
  assert.throws(() => validateBuildEnv(local, true));
});
test('secret keys and service-role JWT cannot enter build', () => {
  for (const key of ['sb_secret_example', 'x.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.x']) {
    assert.throws(() => validateBuildEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key }, true));
  }
});
test('unexpected VITE variables and URL credentials are rejected', () => {
  assert.throws(() => validateBuildEnv({ ...env, VITE_DB_PASSWORD: 'example' }));
  assert.throws(() => validateBuildEnv({ ...env, VITE_SUPABASE_URL: 'https://user:password@example.com' }));
});

test('Vercel injected deployment and Git metadata are accepted', () => {
  assert.doesNotThrow(() => validateBuildEnv({ ...env,
    VITE_VERCEL_ENV: 'production', VITE_VERCEL_TARGET_ENV: 'production',
    VITE_VERCEL_URL: 'construction-crm-example.vercel.app',
    VITE_VERCEL_BRANCH_URL: 'construction-crm-git-main-example.vercel.app',
    VITE_VERCEL_PROJECT_PRODUCTION_URL: 'construction-crm.vercel.app',
    VITE_VERCEL_HASH_SALT: 'public-example',
    VITE_VERCEL_GIT_PROVIDER: 'github', VITE_VERCEL_GIT_REPO_SLUG: 'construction-crm',
    VITE_VERCEL_GIT_REPO_OWNER: 'demo', VITE_VERCEL_GIT_REPO_ID: '123',
    VITE_VERCEL_GIT_COMMIT_REF: 'main', VITE_VERCEL_GIT_COMMIT_SHA: 'abc123',
    VITE_VERCEL_GIT_COMMIT_MESSAGE: 'Prepare deployment',
    VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN: 'demo', VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME: 'Demo',
    VITE_VERCEL_GIT_PULL_REQUEST_ID: '1',
  }, true));
});
test('Vercel prefix does not allow arbitrary credentials or unknown metadata', () => {
  for (const name of ['VITE_VERCEL_TOKEN', 'VITE_VERCEL_SERVICE_ROLE_KEY', 'VITE_VERCEL_FUTURE_FIELD']) {
    assert.throws(() => validateBuildEnv({ ...env, [name]: 'example' }, true));
  }
});
test('secret keys hidden in allowed metadata are rejected without logging values', () => {
  const jwt = 'x.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.x';
  for (const value of ['sb_secret_example', jwt, 'commit containing sb_secret_example', 'commit containing ' + jwt]) {
    assert.throws(() => validateBuildEnv({ ...env, VITE_VERCEL_GIT_COMMIT_MESSAGE: value }, true), error => {
      assert.equal(error.message.includes(value), false);
      return /Secret Supabase credentials/.test(error.message);
    });
  }
});
test('legacy anon JWT remains accepted with Vercel metadata', () => {
  const key = 'x.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.x';
  assert.doesNotThrow(() => validateBuildEnv({ ...env, VITE_SUPABASE_PUBLISHABLE_KEY: key, VITE_VERCEL_ENV: 'production' }, true));
});
test('Vercel metadata cannot bypass missing configuration or localhost checks', () => {
  assert.throws(() => validateBuildEnv({ VITE_VERCEL_ENV: 'production' }, true));
  assert.throws(() => validateBuildEnv({ ...env, VITE_VERCEL_ENV: 'production', VITE_SUPABASE_URL: 'http://localhost:54321' }, true));
});
