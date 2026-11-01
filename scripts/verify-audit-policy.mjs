import assert from "node:assert/strict";
import test from "node:test";
import { isCliEntrypoint, validateAuditExit, validateAuditReport } from "./audit-dependencies.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const paths = {
  "node_modules/minimatch": { version: "3.1.5", dev: true },
  "node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch": { version: "10.2.4", dev: true },
  "node_modules/eslint": { version: "9.0.0", dev: true },
  "node_modules/@eslint-community/eslint-utils": { version: "4.0.0", dev: true },
};
const counts = (total, moderate = total) => ({ info: 0, low: 0, moderate, high: 0, critical: 0, total });
const advisory = () => ({ source: 1244012, name: "minimatch", dependency: "minimatch", url: "https://github.com/advisories/GHSA-g3hv-75wg-m249", severity: "moderate", range: "<11.0.1" });
const reviewOptions = { lockPackages: paths, now: "2026-11-01T00:00:00Z" };
function report(entries = {}, metadata = counts(Object.keys(entries).length)) {
  return { auditReportVersion: 2, vulnerabilities: entries, metadata: { vulnerabilities: metadata } };
}
function minimatch() {
  return { name: "minimatch", severity: "moderate", range: "<11.0.1", nodes: Object.keys(paths).slice(0, 2), via: [advisory()] };
}
function graph() {
  return {
    minimatch: minimatch(),
    eslint: { name: "eslint", severity: "moderate", range: ">=4.1.0", nodes: ["node_modules/eslint"], via: ["@eslint-community/eslint-utils", "minimatch"] },
    "@eslint-community/eslint-utils": { name: "@eslint-community/eslint-utils", severity: "moderate", range: "*", nodes: ["node_modules/@eslint-community/eslint-utils"], via: ["eslint"] },
  };
}

test("clean production report passes", () => {
  assert.equal(validateAuditReport(report({}, counts(0, 0)), { lockPackages: paths, production: true }).ok, true);
  assert.equal(validateAuditExit(report({}, counts(0, 0)), 0, { production: true }).ok, true);
  assert.equal(validateAuditExit(report(graph(), counts(3)), 1).ok, true);
  assert.match(validateAuditExit(report({}, counts(0, 0)), 1).reason, /status/);
  assert.match(validateAuditExit(report(graph(), counts(3)), 0).reason, /status/);
});

test("the reviewed minimatch graph accepts rooted dependency cycles", () => {
  const entries = graph();
  assert.equal(validateAuditReport(report(entries, counts(3)), { ...reviewOptions, now: "2026-11-30T23:59:59Z" }).ok, true);
});

test("new advisory, high severity, production node and unrooted cycle fail closed", () => {
  const base = graph();
  const extra = { name: "unknown", severity: "low", range: "*", nodes: ["node_modules/eslint"], via: [] };
  assert.match(validateAuditReport(report({ ...base, unknown: extra }, { info: 0, low: 1, moderate: 3, high: 0, critical: 0, total: 4 }), reviewOptions).reason, /lockfile|missing vulnerability edge|unrooted/);
  assert.match(validateAuditReport(report({ ...base, eslint: { ...base.eslint, severity: "high" }, }, { info: 0, low: 0, moderate: 2, high: 1, critical: 0, total: 3 }), reviewOptions).reason, /high/);
  const productionLock = { ...paths, "node_modules/minimatch": { version: "3.1.5", dev: false } };
  assert.match(validateAuditReport(report(base, counts(3)), { ...reviewOptions, lockPackages: productionLock }).reason, /production/);
  const cycle = { eslint: { ...base.eslint, via: ["@eslint-community/eslint-utils"] }, "@eslint-community/eslint-utils": { ...base["@eslint-community/eslint-utils"], via: ["eslint"] } };
  assert.match(validateAuditReport(report(cycle, counts(2, 2)), reviewOptions).reason, /accepted minimatch/);
});

test("schema, edge, exact-copy and expiry changes fail", () => {
  const base = graph();
  assert.match(validateAuditReport({ auditReportVersion: 1, vulnerabilities: {}, metadata: { vulnerabilities: counts(0, 0) } }, { lockPackages: paths }).reason, /malformed/);
  assert.match(validateAuditReport(report({ ...base, eslint: { ...base.eslint, via: ["missing"] } }, counts(3)), reviewOptions).reason, /missing/);
  assert.match(validateAuditReport(report({ ...base, minimatch: { ...base.minimatch, via: [{ ...advisory(), url: "https://evil.test" }] } }, counts(3)), reviewOptions).reason, /unaccepted/);
  assert.match(validateAuditReport(report({ ...base, minimatch: { ...base.minimatch, via: [{ ...advisory(), source: 999 }] } }, counts(3)), reviewOptions).reason, /unaccepted/);
  assert.match(validateAuditReport({ ...report(base, counts(3)), error: {} }, reviewOptions).reason, /error/);
  assert.match(validateAuditReport(report(base, counts(3)), { ...reviewOptions, now: "invalid" }).reason, /invalid/);
  assert.match(validateAuditReport(report(base, counts(3)), { ...reviewOptions, now: "2026-12-01T00:00:00Z" }).reason, /expired/);
  assert.equal(isCliEntrypoint(pathToFileURL(resolve("/tmp/qa audit gate/audit-dependencies.mjs")).href, "/tmp/qa audit gate/audit-dependencies.mjs"), true);
  assert.equal(isCliEntrypoint(pathToFileURL(resolve("/tmp/qa audit gate/audit-dependencies.mjs")).href, "/tmp/qa-audit-dependencies.mjs"), false);
});

test("CLI entrypoint with spaces fails visibly when its lockfile is absent", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "qa audit gate "));
  const entry = resolve(directory, "audit-dependencies.mjs");
  try {
    copyFileSync(fileURLToPath(new URL("./audit-dependencies.mjs", import.meta.url)), entry);
    const result = spawnSync(process.execPath, [entry], { cwd: directory, encoding: "utf8" });
    if (result.error) {
      // The restricted local runner may forbid child processes; that is itself
      // a failed subprocess and must never be treated as a passing audit.
      assert.equal(result.error.code, "EPERM");
    } else {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Dependency audit gate failed/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("every accepted advisory identity field and reviewed copy is enforced", () => {
  const base = graph();
  for (const change of [
    { name: "other" }, { dependency: "other" }, { severity: "low" }, { range: "*" },
    { url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz" }, { source: 1 },
  ]) {
    const changed = { ...base, minimatch: { ...base.minimatch, via: [{ ...advisory(), ...change }] } };
    assert.match(validateAuditReport(report(changed, counts(3)), reviewOptions).reason, /unaccepted/);
  }
  const changedVersion = { ...paths, "node_modules/minimatch": { version: "3.1.6", dev: true } };
  assert.match(validateAuditReport(report(base, counts(3)), { ...reviewOptions, lockPackages: changedVersion }).reason, /unreviewed/);
  const missingCopy = { ...base, minimatch: { ...base.minimatch, nodes: ["node_modules/minimatch"] } };
  assert.match(validateAuditReport(report(missingCopy, counts(3)), reviewOptions).reason, /node set/);
});

test("new advisory on an otherwise valid dev node and detached cycles fail", () => {
  const base = graph();
  const changed = { ...base, eslint: { ...base.eslint, via: [{ ...advisory(), name: "eslint", dependency: "eslint" }, "minimatch"] } };
  assert.match(validateAuditReport(report(changed, counts(3)), reviewOptions).reason, /unaccepted/);
  const detached = {
    ...base,
    a: { name: "a", severity: "moderate", range: "*", nodes: ["node_modules/a"], via: ["b"] },
    b: { name: "b", severity: "moderate", range: "*", nodes: ["node_modules/b"], via: ["a"] },
  };
  const withNodes = { ...paths, "node_modules/a": { version: "1", dev: true }, "node_modules/b": { version: "1", dev: true } };
  assert.match(validateAuditReport(report(detached, counts(5)), { ...reviewOptions, lockPackages: withNodes }).reason, /unrooted/);
});
