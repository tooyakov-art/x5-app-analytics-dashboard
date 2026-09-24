import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const main = read("main.js");
const api = read("api.js");
const supabase = read("supabase.js");
const migration = readFileSync(
  new URL("../../ios/supabase/migrations/20260925090000_admin_analytics.sql", import.meta.url),
  "utf8",
);

// Every report the dashboard calls must exist in the migration, and every one
// of those functions must check the developer gate before returning data.
const called = [...api.matchAll(/rpc\("(admin_analytics_[a-z_]+)"/g)].map((match) => match[1]);
assert.ok(called.length >= 6, "the dashboard should call every report");
for (const name of new Set(called)) {
  assert.ok(migration.includes(`function public.${name}(`), `${name} is missing from the migration`);
  const body = migration.split(`function public.${name}(`)[1].split("$$;")[0];
  assert.match(body, /x5_require_developer\(\)/, `${name} does not check the developer gate`);
}

// The browser only ever gets the anon key; aggregates come from the server.
assert.doesNotMatch(main + api + supabase, /service[_-]?role/i);
assert.doesNotMatch(main + api, /from\("(profiles|iap_entitlements|image_generation_requests)"\)/);
assert.match(supabase, /VITE_SUPABASE_ANON_KEY/);
assert.match(main, /downloadCsv/);

console.log("Dashboard security contract OK");
