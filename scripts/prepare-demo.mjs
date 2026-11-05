import { execFileSync } from "node:child_process";
import { prepareDemo } from "./demo-data.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
const status = JSON.parse(
  execFileSync("node_modules/.bin/supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
for (const value of [status.API_URL, status.DB_URL])
  if (new URL(value).hostname !== "127.0.0.1")
    throw Error("Local database required");
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const db = new pg.Client({ connectionString: status.DB_URL });
const saved = existsSync(".local/demo.json")
  ? JSON.parse(readFileSync(".local/demo.json", "utf8")) : { users: {} };
function saveCredentials(value) {
  mkdirSync(".local", { recursive: true, mode: 0o700 });
  writeFileSync(".local/demo.json.tmp", JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(".local/demo.json.tmp", ".local/demo.json");
}
await prepareDemo({ admin, db, saved, saveCredentials });
writeFileSync(
  ".env.local",
  "VITE_SUPABASE_URL=" +
    status.API_URL +
    "\nVITE_SUPABASE_PUBLISHABLE_KEY=" +
    status.PUBLISHABLE_KEY +
    "\n",
  { mode: 0o600 },
);
console.log(
  "Prepared 4 local accounts, 3 objects, 3 tasks. Credentials: .local/demo.json",
);
