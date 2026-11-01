import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPIRY = "2026-12-01T00:00:00.000Z";
const ACCEPTED_GHSA = "GHSA-g3hv-75wg-m249";
const ACCEPTED_URL = `https://github.com/advisories/${ACCEPTED_GHSA}`;
const ACCEPTED_PATHS = new Map([
  ["node_modules/minimatch", "3.1.5"],
  ["node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch", "10.2.4"],
]);
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];

function fail(message) {
  return { ok: false, reason: message };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function packageNameFromPath(path) {
  const marker = "/node_modules/";
  const last = path.includes(marker) ? path.slice(path.lastIndexOf(marker) + marker.length) : path.slice("node_modules/".length);
  if (!path.startsWith("node_modules/") || !last || last.startsWith(".")) return null;
  const packageParts = last.split("/");
  const packageName = packageParts[0]?.startsWith("@") ? packageParts.slice(0, 2).join("/") : packageParts[0];
  if (!packageName || packageParts.length !== (packageName.startsWith("@") ? 2 : 1)) return null;
  return packageName;
}

function validateMetadata(report) {
  if (!isRecord(report.metadata) || !isRecord(report.metadata.vulnerabilities)) {
    return "metadata.vulnerabilities is missing";
  }
  const metadata = report.metadata.vulnerabilities;
  if (SEVERITIES.some((severity) => !Number.isInteger(metadata[severity]) || metadata[severity] < 0)) {
    return "metadata vulnerability counts are invalid";
  }
  const total = SEVERITIES.reduce((sum, severity) => sum + metadata[severity], 0);
  if (metadata.total !== total) return "metadata total does not match severity counts";
  return null;
}

function validateNode(path, name, lockPackages) {
  if (typeof path !== "string" || !path.startsWith("node_modules/")) return "vulnerability node path is invalid";
  const lock = lockPackages[path];
  if (!isRecord(lock) || typeof lock.version !== "string") return `lockfile node is missing: ${path}`;
  if (packageNameFromPath(path) !== name) return `lockfile node name mismatch: ${path}`;
  return null;
}

function isAcceptedAdvisory(value) {
  return isRecord(value) && value.name === "minimatch" && value.dependency === "minimatch"
    && value.url === ACCEPTED_URL && value.severity === "moderate" && value.range === "<11.0.1"
    && (value.source === undefined || value.source === 1244012);
}

function auditAdvisory(value) {
  if (!isAcceptedAdvisory(value)) return false;
  return true;
}

/** Validate one npm audit JSON result against the committed lockfile. */
export function validateAuditReport(report, { lockPackages, production = false, now = new Date() } = {}) {
  if (!isRecord(report) || report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)) {
    return fail("npm audit returned an unsupported or malformed report");
  }
  if (Object.hasOwn(report, "error")) return fail("npm audit returned an error report");
  const timestamp = new Date(now).getTime();
  if (!Number.isFinite(timestamp)) return fail("audit exception time is invalid");
  const metadataError = validateMetadata(report);
  if (metadataError) return fail(metadataError);
  const vulnerabilities = report.vulnerabilities;
  const actualCounts = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const entry of Object.values(vulnerabilities)) {
    if (isRecord(entry) && SEVERITIES.includes(entry.severity)) actualCounts[entry.severity] += 1;
  }
  if (SEVERITIES.some((severity) => report.metadata.vulnerabilities[severity] !== actualCounts[severity])) {
    return fail("metadata vulnerability counts do not match report entries");
  }
  if (production) {
    return Object.keys(vulnerabilities).length === 0 && report.metadata.vulnerabilities.total === 0
      ? { ok: true, accepted: 0 }
      : fail("production dependencies contain vulnerabilities");
  }
  if (!(lockPackages && isRecord(lockPackages))) return fail("package-lock packages are unavailable");
  if (Object.keys(vulnerabilities).length === 0) return { ok: true, accepted: 0 };
  if (timestamp >= Date.parse(EXPIRY)) return fail("the temporary minimatch exception has expired");

  const accepted = new Set();
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!isRecord(entry) || entry.name !== name || !SEVERITIES.includes(entry.severity)
      || typeof entry.range !== "string" || !entry.range || !Array.isArray(entry.nodes) || entry.nodes.length === 0
      || !Array.isArray(entry.via) || new Set(entry.nodes).size !== entry.nodes.length) {
      return fail(`malformed vulnerability entry: ${name}`);
    }
    for (const node of entry.nodes) {
      const nodeError = validateNode(node, name, lockPackages);
      if (nodeError) return fail(nodeError);
      if (lockPackages[node].dev !== true) return fail(`development exception reached a production node: ${node}`);
    }
    if (entry.severity === "high" || entry.severity === "critical") return fail(`unaccepted ${entry.severity} vulnerability: ${name}`);
    for (const via of entry.via) {
      if (typeof via === "object") {
        if (!auditAdvisory(via)) return fail(`unaccepted advisory in ${name}`);
      } else if (typeof via !== "string" || !Object.hasOwn(vulnerabilities, via)) {
        return fail(`missing vulnerability edge from ${name}`);
      }
    }
    if (name === "minimatch") {
      if (entry.nodes.length !== ACCEPTED_PATHS.size) return fail("minimatch node set changed");
      for (const node of entry.nodes) {
        if (ACCEPTED_PATHS.get(node) !== lockPackages[node].version) return fail(`unreviewed minimatch copy: ${node}`);
      }
    }
  }

  // Follow vulnerability edges backwards from the sole accepted advisory. This
  // deliberately permits peer-dependency cycles that are rooted in minimatch,
  // while rejecting unrelated cycles and every unreviewed advisory.
  if (!Object.hasOwn(vulnerabilities, "minimatch")) return fail("accepted minimatch advisory root is missing");
  if (!vulnerabilities.minimatch.via.some(auditAdvisory)) return fail("accepted minimatch advisory is missing");
  accepted.add("minimatch");
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, entry] of Object.entries(vulnerabilities)) {
      if (!accepted.has(name) && entry.via.some((via) => typeof via === "string" && accepted.has(via))) {
        accepted.add(name); changed = true;
      }
    }
  }
  if (accepted.size !== Object.keys(vulnerabilities).length) {
    return fail(`unrooted or unapproved vulnerability entries: ${Object.keys(vulnerabilities).filter((name) => !accepted.has(name)).join(", ")}`);
  }
  return { ok: true, accepted: Object.keys(vulnerabilities).length, exception: ACCEPTED_GHSA, expiry: EXPIRY };
}

export function validateAuditExit(report, status, { production = false } = {}) {
  if (status !== 0 && status !== 1) return fail(`npm audit exited with unexpected status ${status}`);
  const hasFindings = isRecord(report?.vulnerabilities) && Object.keys(report.vulnerabilities).length > 0;
  if ((status === 0) !== !hasFindings) return fail(`npm audit exit status ${status} does not match report findings`);
  if (production && hasFindings) return fail("production audit returned findings");
  return { ok: true };
}

function runNpmAudit(args, cwd) {
  const npmExec = process.env.npm_execpath;
  const command = npmExec ? process.execPath : "npm";
  if (npmExec && (!npmExec.endsWith(".js") || !existsSync(npmExec))) throw new Error("npm_execpath is not a readable npm CLI file");
  const commandArgs = npmExec ? [npmExec, "audit", ...args] : ["audit", ...args];
  const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8", timeout: 90_000, maxBuffer: 2_000_000, shell: false });
  if (result.error || result.signal || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit execution failed (${result.error?.code ?? result.signal ?? result.status ?? "unknown"})`);
  }
  let report;
  try { report = JSON.parse(result.stdout || ""); } catch { throw new Error("npm audit returned malformed JSON"); }
  if (isRecord(report) && report.error) throw new Error("npm audit returned an error report");
  return { report, status: result.status };
}

export function auditDependencies({ cwd = resolve("."), now = new Date() } = {}) {
  const lock = JSON.parse(readFileSync(resolve(cwd, "package-lock.json"), "utf8"));
  const lockPackages = lock.packages;
  const productionRun = runNpmAudit(["--json", "--omit=dev", "--include=optional", "--include=peer", "--audit-level=info", "--fetch-retries=0", "--fetch-timeout=20000"], cwd);
  const productionExit = validateAuditExit(productionRun.report, productionRun.status, { production: true });
  if (!productionExit.ok) throw new Error(`Production audit failed: ${productionExit.reason}`);
  const productionResult = validateAuditReport(productionRun.report, { lockPackages, production: true, now });
  if (!productionResult.ok) throw new Error(`Production audit failed: ${productionResult.reason}`);
  const fullRun = runNpmAudit(["--json", "--include=prod", "--include=dev", "--include=optional", "--include=peer", "--audit-level=info", "--fetch-retries=0", "--fetch-timeout=20000"], cwd);
  const fullExit = validateAuditExit(fullRun.report, fullRun.status);
  if (!fullExit.ok) throw new Error(`Full dependency audit failed: ${fullExit.reason}`);
  const fullResult = validateAuditReport(fullRun.report, { lockPackages, now });
  if (!fullResult.ok) throw new Error(`Full dependency audit failed: ${fullResult.reason}`);
  return { production: productionResult, full: fullResult };
}

export function isCliEntrypoint(moduleUrl, argvPath) {
  return Boolean(argvPath) && resolve(fileURLToPath(moduleUrl)) === resolve(argvPath);
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  try {
    const result = auditDependencies();
    console.log("Production audit: clean");
    if (result.full.exception) console.log(`Full audit: ${result.full.accepted} development findings accepted under ${result.full.exception} until 2026-11-30 UTC`);
    else console.log("Full audit: clean");
  } catch (error) {
    console.error(`Dependency audit gate failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  }
}
