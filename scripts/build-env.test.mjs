import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

test('unknown names are reported deterministically without values', () => {
  const secret = 'do-not-log-this-value';
  assert.throws(() => validateBuildEnv({ ...env, VITE_Z_UNKNOWN: secret, VITE_A_UNKNOWN: secret }), error => {
    assert.match(error.message, /VITE_A_UNKNOWN, VITE_Z_UNKNOWN/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});

// Exercise the real CLI and Vite loadEnv, not only the validation function.
const checkScript = fileURLToPath(new URL('./check-build-env.mjs', import.meta.url));
function runCheck(extra = {}, envFile = '') {
  const cwd = mkdtempSync(join(tmpdir(), 'crm-build-env-'));
  try {
    writeFileSync(join(cwd, '.env.production'), envFile);
    const result = spawnSync(process.execPath, [checkScript], {
      cwd,
      env: { PATH: process.env.PATH, VERCEL: '1', ...env, ...extra },
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  } finally { rmSync(cwd, { recursive: true, force: true }); }
}
test('CLI accepts Supabase configuration with injected Vercel variables', () => {
  const result = runCheck({ VITE_VERCEL_ENV: 'production', VITE_VERCEL_URL: 'crm.vercel.app', VITE_VERCEL_GIT_COMMIT_SHA: 'example' });
  assert.equal(result.status, 0);
  assert.match(result.output, /environment validated/);
  assert.equal(result.output.includes(env.VITE_SUPABASE_PUBLISHABLE_KEY), false);
});
test('CLI rejects unknown variables loaded from production env files without values', () => {
  const result = runCheck({}, 'VITE_UNKNOWN_FROM_FILE=private-value-from-file');
  assert.equal(result.status, 1);
  assert.match(result.output, /VITE_UNKNOWN_FROM_FILE/);
  assert.equal(result.output.includes('private-value-from-file'), false);
});
test('CLI rejects potentially secret variables injected by the platform', () => {
  const result = runCheck({ VITE_VERCEL_AUTOMATION_BYPASS_SECRET: 'never-log-this-secret' });
  assert.equal(result.status, 1);
  assert.match(result.output, /VITE_VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.equal(result.output.includes('never-log-this-secret'), false);
});
test('CLI rejects service role JWT hidden in allowed metadata', () => {
  const jwt = 'x.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.x';
  const result = runCheck({ VITE_VERCEL_GIT_COMMIT_MESSAGE: jwt });
  assert.equal(result.status, 1);
  assert.match(result.output, /Secret Supabase credentials/);
  assert.equal(result.output.includes(jwt), false);
});
test('CLI never echoes a malformed Supabase URL in diagnostics', () => {
  const result = runCheck({ VITE_SUPABASE_URL: 'not-a-url-with-private-content' });
  assert.equal(result.status, 1);
  assert.match(result.output, /valid Supabase API URL/);
  assert.equal(result.output.includes('not-a-url-with-private-content'), false);
});

// Exact additional names reported by the failed Vercel CLI 65.11.0 build.
const vercel65 = {
  VITE_VERCEL_DEPLOYMENT_ID: 'dpl_example',
  VITE_VERCEL_PROJECT_ID: 'prj_example',
  VITE_VERCEL_GIT_PREVIOUS_SHA: '', // No successful previous build on first deployment.
  VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG: JSON.stringify({
    analytics: { scriptSrc: '/example/script.js', eventEndpoint: '/example/event', viewEndpoint: '/example/view' },
    speedInsights: { scriptSrc: '/example/vitals.js', endpoint: '/example/vitals' },
  }),
};
test('CLI accepts the four variables from the failed Vercel 65 build', () => {
  for (const previous of ['', 'a'.repeat(40)]) {
    const result = runCheck({ ...vercel65, VITE_VERCEL_GIT_PREVIOUS_SHA: previous });
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /environment validated/);
    assert.equal(result.output.includes(vercel65.VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG), false);
  }
});
test('new Vercel metadata does not allow unknown or secret variable names', () => {
  for (const name of ['VITE_UNKNOWN', 'VITE_VERCEL_API_TOKEN', 'VITE_VERCEL_AUTOMATION_BYPASS_SECRET']) {
    const result = runCheck({ ...vercel65, [name]: 'private-example-value' });
    assert.equal(result.status, 1);
    assert.ok(result.output.includes(name));
    assert.equal(result.output.includes('private-example-value'), false);
  }
});
test('every newly allowed Vercel field still rejects Supabase secret values', () => {
  const jwt = 'x.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.x';
  for (const name of Object.keys(vercel65)) {
    for (const secret of ['sb_secret_example', jwt]) {
      const value = name.endsWith('CLIENT_CONFIG') ? JSON.stringify({ analytics: { token: secret } }) : secret;
      assert.throws(() => validateBuildEnv({ ...env, ...vercel65, [name]: value }, true), error => {
        assert.match(error.message, /Secret Supabase credentials/);
        assert.equal(error.message.includes(secret), false);
        return true;
      });
    }
  }
});
