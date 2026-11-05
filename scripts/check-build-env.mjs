import { loadEnv } from 'vite';
import { pathToFileURL } from 'node:url';
// Explicit public metadata list; a VITE_VERCEL_ prefix is not permission to expose secrets.
const vercelMetadata = new Set([
  'ENV', 'TARGET_ENV', 'URL', 'BRANCH_URL', 'PROJECT_PRODUCTION_URL', 'HASH_SALT',
  'GIT_PROVIDER', 'GIT_REPO_SLUG', 'GIT_REPO_OWNER', 'GIT_REPO_ID',
  'GIT_COMMIT_REF', 'GIT_COMMIT_SHA', 'GIT_COMMIT_MESSAGE',
  'GIT_COMMIT_AUTHOR_LOGIN', 'GIT_COMMIT_AUTHOR_NAME', 'GIT_PULL_REQUEST_ID',
].map(name => 'VITE_VERCEL_' + name));
function jwtRole(value) {
  try { return JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString()).role; }
  catch { return undefined; }
}
export function validateBuildEnv(env, hosted = false) {
  const allowed = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
  const unexpected = Object.keys(env)
    .filter(name => name.startsWith('VITE_') && !allowed.includes(name) && !vercelMetadata.has(name))
    .sort();
  if (unexpected.length) {
    // Names only: values may contain credentials, including for unknown variables.
    const names = unexpected.map(name => /^[A-Z0-9_]+$/.test(name) ? name : '<invalid variable name>');
    throw Error(`Unexpected VITE_ variable(s): ${names.join(', ')}. Remove them or review the explicit allowlist; values hidden.`);
  }
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_')) continue;
    // Also check metadata values so renaming a key cannot bypass the protection.
    if (/sb_secret_[A-Za-z0-9_-]+/.test(value) ||
        [...value.matchAll(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)]
          .some(([token]) => jwtRole(token) === 'service_role')) {
      throw Error('Secret Supabase credentials cannot be exposed through VITE_ variables');
    }
  }
  if (!allowed.every(k => env[k])) throw Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY before build');
  let url;
  try { url = new URL(env.VITE_SUPABASE_URL); }
  catch { throw Error('VITE_SUPABASE_URL must be a valid Supabase API URL (value hidden)'); }
  const local = ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('Use the Supabase API origin only');
  if (hosted && (url.protocol !== 'https:' || !/^[a-z]{20}\.supabase\.co$/.test(url.hostname))) throw Error('Vercel build requires the hosted Supabase HTTPS URL');
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw Error('Supabase URL must use HTTPS (except local development)');
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (key.startsWith('sb_publishable_')) return;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (key.split('.').length === 3 && payload.role === 'anon') return;
  } catch { /* Fail closed without logging the key. */ }
  throw Error('Only a publishable key or legacy anon JWT is allowed in frontend');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateBuildEnv(loadEnv('production', process.cwd(), 'VITE_'), process.env.VERCEL === '1');
  console.log('Frontend build environment validated (values hidden)');
}
