import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const api = readFileSync(new URL("../src/api.js", import.meta.url), "utf8");
const supabase = readFileSync(new URL("../src/supabase.js", import.meta.url), "utf8");

assert.match(api, /dashboard_access_check/);
for (const rpc of ["dashboard_overview", "dashboard_timeseries", "dashboard_users", "dashboard_user_details", "dashboard_payments", "dashboard_sources_status"]) {
  assert.match(api, new RegExp(rpc));
}
for (const rpc of ["dashboard_kaspi_payments", "review_kaspi_credit_payment"]) {
  assert.match(api, new RegExp(rpc));
}
assert.doesNotMatch(main + api + supabase, /service[_-]?role/i);
assert.doesNotMatch(main + api, /raw\.githubusercontent\.com/);
assert.doesNotMatch(main + api, /analytics-data\/latest\.json/);
assert.match(main, /signInWithPassword|dashboardApi\.signIn/);
assert.match(main, /csv_export/);
assert.match(main, /data-kaspi-confirm/);
assert.match(main, /reviewKaspiPayment/);
console.log("Dashboard security contract OK");
