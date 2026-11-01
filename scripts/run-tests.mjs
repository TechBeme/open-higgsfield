import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const scripts = resolve(root, "scripts");
const tests = readdirSync(scripts, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.startsWith("verify-") && entry.name.endsWith(".mjs"))
  .map((entry) => resolve(scripts, entry.name))
  .sort();

// Node's test glob succeeds with zero matches, so require a real suite first.
if (tests.length === 0) {
  throw new Error("No regression scripts found: expected scripts/verify-*.mjs");
}
if (process.env.REQUIRE_POSTGRES_TESTS === "1" && !tests.includes(resolve(scripts, "verify-task-postgres.mjs"))) {
  throw new Error("Required PostgreSQL regression script is missing");
}

const result = spawnSync(process.execPath, ["--test", ...process.argv.slice(2), ...tests], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.signal) console.error(`Regression tests stopped by ${result.signal}`);
process.exit(result.status ?? 1);
