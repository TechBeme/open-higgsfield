import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createModuleLoader } from "./test-module-loader.mjs";

const configured = Boolean(process.env.TEST_POSTGRES_HOST && process.env.TEST_POSTGRES_DB && process.env.TEST_POSTGRES_USER);
const required = process.env.REQUIRE_POSTGRES_TESTS === "1";
const quote = (value) => value == null ? "NULL" : typeof value === "boolean" ? String(value) :
    typeof value === "number" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;

function psql(statement) {
    return new Promise((resolve, reject) => {
        const child = spawn("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {
            env: { PATH: process.env.PATH, PGHOST: process.env.TEST_POSTGRES_HOST,
                PGPORT: process.env.TEST_POSTGRES_PORT ?? "5432", PGDATABASE: process.env.TEST_POSTGRES_DB,
                PGUSER: process.env.TEST_POSTGRES_USER, PGPASSWORD: process.env.TEST_POSTGRES_PASSWORD ?? "", PGCONNECT_TIMEOUT: "5" },
            stdio: ["pipe", "pipe", "pipe"],
        });
        let output = ""; let error = "";
        child.stdout.on("data", (chunk) => { output += chunk; });
        child.stderr.on("data", (chunk) => { error += chunk; });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(`Isolated PostgreSQL test failed: ${error}`)));
        child.stdin.end(statement);
    });
}

function fixture(id, overrides = {}) {
    const now = Date.now();
    return { task_id: id, media_type: "image", model_id: "synthetic", status: "IN_PROGRESS",
        created_at: new Date(now).toISOString(), provider_id: "freepik", provider_operation: { pollUrl: `/synthetic/${id}` },
        lifecycle_phase: "polling", next_poll_at: new Date(now - 1_000).toISOString(),
        deadline_at: new Date(now + 86_400_000).toISOString(), poll_failures: 0,
        lease_token: null, lease_expires_at: null, deleted_at: null, ...overrides };
}

test("PostgreSQL task migration, independent stores, claims and bounded public reads", { skip: !configured && !required }, async (t) => {
    assert.ok(configured, "REQUIRE_POSTGRES_TESTS=1 requires explicit TEST_POSTGRES_HOST/DB/USER");
    const schema = `task_test_${randomUUID().replaceAll("-", "")}`;
    const prefix = `SET standard_conforming_strings = on; SET search_path TO ${schema};\n`;
    const exec = (sql) => psql(prefix + sql);
    await psql(`CREATE SCHEMA ${schema};`);
    try {
        const migration = await fs.readFile(path.join(import.meta.dirname, "../migrations/0001_durable_task_lifecycle.sql"), "utf8");
        await exec(`CREATE TABLE generation_tasks(task_id TEXT PRIMARY KEY, media_type TEXT NOT NULL, status TEXT NOT NULL,
            payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
        const legacy = [
            fixture("legacy-pending"),
            fixture("legacy-incomplete", { status: "COMPLETED" }),
            fixture("legacy-lost", { status: "COMPLETED", provider_operation: undefined }),
            fixture("legacy-unknown", { provider_operation: undefined }),
            fixture("legacy-terminal", { status: "FAILED" }),
        ];
        for (const row of legacy) {
            await exec(`INSERT INTO generation_tasks(task_id,media_type,status,payload,created_at) VALUES (${quote(row.task_id)},'image',${quote(row.status)},${quote(JSON.stringify(row))}::jsonb,${quote(row.created_at)});`);
        }
        await exec(migration);
        await exec(migration);
        const transfers = [];
        const query = async (statement, values = []) => {
            const sql = statement.replace(/\$(\d+)/g, (_, index) => quote(values[Number(index) - 1]));
            const raw = await exec(`WITH __result AS (${sql}) SELECT COALESCE(json_agg(__result), '[]'::json) FROM __result;`);
            transfers.push({ statement, bytes: Buffer.byteLength(raw) });
            return JSON.parse(raw);
        };
        const newProcess = (extraMocks = {}) => createModuleLoader({ env: { DATABASE_URL: "postgres://synthetic.invalid/test", TASK_WORKER_MODE: "external" },
            mocks: { "@neondatabase/serverless": { neon: () => ({ query }) }, ...extraMocks } });
        const one = newProcess().load("@/lib/task-store");
        const two = newProcess().load("@/lib/task-store");
        await t.test("legacy backfill is deterministic and migration is idempotent", async () => {
            assert.equal((await one.getTask("legacy-pending")).lifecycle_phase, "polling");
            assert.equal((await one.getTask("legacy-incomplete")).lifecycle_phase, "materializing");
            assert.equal((await one.getTask("legacy-lost")).lifecycle_phase, "paused");
            assert.equal((await one.getTask("legacy-unknown")).lifecycle_phase, "submission_unknown");
            assert.equal((await one.getTask("legacy-terminal")).lifecycle_phase, "terminal");
        });
        await t.test("stale snapshots cannot overwrite, resurrect or modify unrelated rows", async () => {
            await one.createTask(fixture("a"));
            const stale = await two.getTask("a");
            const current = await one.getTask("a");
            await one.updateTask({ ...current, status: "COMPLETED", lifecycle_phase: "terminal", next_poll_at: null, result_urls: ["https://synthetic.invalid/result.png"] });
            await two.createTask(fixture("b"));
            assert.equal((await two.getTask("a")).status, "COMPLETED");
            assert.equal(await two.updateTask({ ...stale, status: "IN_PROGRESS" }), undefined);
            const before = (await one.getTask("b")).revision;
            assert.equal(await one.deleteTask("a"), true);
            assert.equal(await two.getTask("a"), undefined);
            assert.equal(await two.updateTask(stale), undefined);
            await assert.rejects(two.createTask(fixture("a")), /ERR_TASK_ID_CONFLICT/);
            assert.equal((await one.getTask("b")).revision, before);
        });
        await t.test("concurrent claims are exclusive and expired owners are fenced", async () => {
            await one.createTask(fixture("lease"));
            const claims = await Promise.all([one.claimTask("worker-a", 120_000, "lease"), two.claimTask("worker-b", 120_000, "lease")]);
            assert.equal(claims.filter(Boolean).length, 1);
            const old = claims.find(Boolean);
            await exec("UPDATE generation_tasks SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE task_id = 'lease';");
            assert.equal(await one.updateTask(old), undefined);
            const recovered = await two.claimTask("worker-recovered", 120_000, "lease");
            assert.ok(recovered);
            assert.equal(await one.updateTask({ ...old, status: "FAILED", lifecycle_phase: "terminal", next_poll_at: null }), undefined);
            await one.deleteTask("lease");
            assert.equal(await two.updateTask({ ...recovered, status: "COMPLETED", lifecycle_phase: "terminal", next_poll_at: null }), undefined);
        });
        await t.test("large inline legacy payloads stay out of SQL list and SSE transport", async () => {
            const data = `data:image/png;base64,${"A".repeat(6 * 1024 * 1024)}`;
            await one.createTask(fixture("large", { status: "COMPLETED", lifecycle_phase: "terminal", next_poll_at: null,
                result_urls: [data], events: [{ type: "completed", result_urls: [data] }], reuse_state: { nested: { data } } }));
            transfers.length = 0;
            const page = await two.listTasks("image", { limit: 50 });
            const publicRecord = await two.getPublicTask("large");
            assert.equal(publicRecord.result_urls[0], "/api/download/large?index=0");
            assert.equal(publicRecord.has_download, true);
            assert.ok(!JSON.stringify(page).includes("data:image"));
            assert.ok(!JSON.stringify(page).includes("provider_operation"));
            assert.ok(transfers.every((item) => item.bytes < 100_000), JSON.stringify(transfers));
            assert.ok(transfers.every((item) => !/SELECT \*/.test(item.statement)));
        });
        await t.test("SQL keyset pagination handles identical timestamps without duplication", async () => {
            const created_at = "2030-01-01T00:00:00.000Z";
            for (const id of ["page-a", "page-b", "page-c"]) await one.createTask(fixture(id, { created_at }));
            const first = await one.listTasks("image", { limit: 2 });
            const second = await two.listTasks("image", { limit: 2, cursor: first.nextCursor });
            assert.deepEqual(first.tasks.map((row) => row.task_id), ["page-c", "page-b"]);
            assert.equal(second.tasks[0].task_id, "page-a");
            await assert.rejects(one.listTasks("image", { cursor: "not-json" }), /ERR_INVALID_PAGINATION/);
        });
        await t.test("database emptiness and outage never load local JSON", async () => {
            let localReads = 0;
            const broken = newProcess({ "node:fs/promises": { readFile: () => { localReads++; throw new Error("unexpected fallback"); } },
                "@neondatabase/serverless": { neon: () => ({ query: async () => { throw new Error("offline"); } }) } }).load("@/lib/task-store");
            await assert.rejects(broken.getTask("anything"), /ERR_TASK_SCHEMA_REQUIRED/);
            assert.equal(await one.getTask("never-existed"), undefined);
            const empty = newProcess({ "node:fs/promises": { readFile: () => {
                localReads++; return JSON.stringify([fixture("stale-file", { media_type: "video" })]);
            } } }).load("@/lib/task-store");
            assert.equal((await empty.listTasks("video")).tasks.length, 0);
            assert.equal(localReads, 0);
        });
    } finally { await psql(`DROP SCHEMA ${schema} CASCADE;`); }
});
