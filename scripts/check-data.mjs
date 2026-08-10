import { readFile } from "node:fs/promises";

const raw = await readFile(new URL("../public/data/latest.json", import.meta.url), "utf8");
const data = JSON.parse(raw);
const required = ["schemaVersion", "generatedAt", "sync", "overview", "platforms", "trend", "countries", "builds", "sources"];
for (const key of required) {
  if (!(key in data)) throw new Error(`Missing dashboard data key: ${key}`);
}
if (!Array.isArray(data.platforms) || !Array.isArray(data.trend) || !Array.isArray(data.builds)) {
  throw new Error("Dashboard collection fields must be arrays");
}
console.log("Dashboard data contract OK");
