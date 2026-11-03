import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createModuleLoader } from "./test-module-loader.mjs";

const configured = Boolean(process.env.TEST_POSTGRES_HOST && process.env.TEST_POSTGRES_DB && process.env.TEST_POSTGRES_USER);
const required = process.env.REQUIRE_POSTGRES_TESTS === "1";
const quote = (value) => Array.isArray(value) ? `ARRAY[${value.map(quote).join(",")}]` : value == null ? "NULL" : typeof value === "boolean" ? String(value) :
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
        created_at: new Date(now).toISOString(), provider_id: "google-ai-studio", provider_operation: { pollUrl: `/synthetic/${id}` },
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
        const one = newProcess().load("@/server/tasks/store");
        const two = newProcess().load("@/server/tasks/store");
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
        await t.test("gallery batch edits preserve siblings, persist order and reject stale atomic writes", async () => {
            for (const id of ["gallery-a", "gallery-b", "gallery-c"]) await one.createTask(fixture(id, { status: "COMPLETED", lifecycle_phase: "terminal", next_poll_at: null,
                result_urls: ["https://synthetic.invalid/0.png", "https://synthetic.invalid/1.png"] }));
            await one.mutateGallery("delete", "image", [{ taskId: "gallery-a", index: 0 }, { taskId: "gallery-b", index: 1 }]);
            assert.deepEqual((await two.getTask("gallery-a")).gallery.removed, [0]);
            assert.equal((await two.getTask("gallery-a")).result_urls.length, 2);
            await one.mutateGallery("reorder", "image", [{ taskId: "gallery-c", index: 1 }, { taskId: "gallery-b", index: 0 }, { taskId: "gallery-a", index: 1 }]);
            const pages = await two.listTasks("image", { limit: 50 });
            const ordered = pages.tasks.filter(task => task.task_id.startsWith("gallery-"));
            assert.deepEqual(ordered.map(task => task.task_id), ["gallery-c", "gallery-b", "gallery-a"]);
            const pg = newProcess().load("@/server/tasks/postgres");
            const currentA = await one.getTask("gallery-a"), currentB = await one.getTask("gallery-b");
            const stalePatches = [currentA, currentB].map(task => ({ id: task.task_id, revision: task.revision, gallery: { removed: [0, 1], order: {} }, remove: true }));
            await two.mutateGallery("delete", "image", [{ taskId: "gallery-a", index: 1 }]);
            assert.equal(await exec("SELECT NOT (payload ? 'result_urls' OR payload ? 'provider_operation') FROM generation_tasks WHERE task_id = 'gallery-a';"), "t", "The final removal clears media and provider payloads");
            assert.equal(await pg.applyPersistedGallery(stalePatches), false);
            assert.ok(await one.getTask("gallery-b"), "A stale row must prevent every write in that batch");
            await one.mutateGallery("delete", "image", [{ taskId: "gallery-a", index: 1 }]);
        });
        await t.test("database emptiness and outage never load local JSON", async () => {
            let localReads = 0;
            const broken = newProcess({ "node:fs/promises": { readFile: () => { localReads++; throw new Error("unexpected fallback"); } },
                "@neondatabase/serverless": { neon: () => ({ query: async () => { throw new Error("offline"); } }) } }).load("@/server/tasks/store");
            await assert.rejects(broken.getTask("anything"), /ERR_TASK_SCHEMA_REQUIRED/);
            assert.equal(await one.getTask("never-existed"), undefined);
            const empty = newProcess({ "node:fs/promises": { readFile: () => {
                localReads++; return JSON.stringify([fixture("stale-file", { media_type: "video" })]);
            } } }).load("@/server/tasks/store");
            assert.equal((await empty.listTasks("video")).tasks.length, 0);
            assert.equal(localReads, 0);
        });
    } finally { await psql(`DROP SCHEMA ${schema} CASCADE;`); }
});

test("PostgreSQL provider configuration preserves concurrent changes across independent workers", { skip: !configured && !required }, async (t) => {
    assert.ok(configured, "REQUIRE_POSTGRES_TESTS=1 requires explicit TEST_POSTGRES_HOST/DB/USER");
    const builtInModel = Object.values(createModuleLoader().load("src/server/catalog/image.ts").IMAGE_CAPABILITIES).find(model => !model.deprecated);
    assert.ok(builtInModel, "The concurrency fixture requires a real built-in model");
    const schema = `provider_test_${randomUUID().replaceAll("-", "")}`;
    const exec = statement => psql(`SET standard_conforming_strings = on; SET search_path TO ${schema};\n${statement}`);
    await psql(`CREATE SCHEMA ${schema};`);
    try {
        const migration = await fs.readFile(path.join(import.meta.dirname, "../migrations/0002_provider_runtime_catalog.sql"), "utf8");
        await exec(migration);
        await exec(migration);
        let readsToSynchronize = 0;
        let releaseReads;
        let readBarrier;
        const synchronizeNextReads = () => {
            readsToSynchronize = 2;
            readBarrier = new Promise(resolve => { releaseReads = resolve; });
        };
        let conflicts = 0;
        const query = async (statement, values = []) => {
            const sql = statement.replace(/\$(\d+)/g, (_, index) => quote(values[Number(index) - 1]));
            const result = JSON.parse(await exec(`WITH __result AS (${sql}) SELECT COALESCE(json_agg(__result), '[]'::json) FROM __result;`));
            if (statement.startsWith("SELECT payload") && readsToSynchronize > 0) {
                readsToSynchronize--;
                if (readsToSynchronize === 0) releaseReads();
                await readBarrier;
            }
            if (statement.startsWith("INSERT INTO provider_runtime_config") && result.length === 0) conflicts++;
            return result;
        };
        const env = { DATABASE_URL: "postgres://synthetic.invalid/test", PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-provider-config-key-32-characters" };
        const newStore = (override = query) => createModuleLoader({ env,
            mocks: { "@neondatabase/serverless": { neon: () => ({ query: override }) } },
        }).load("@/server/config/provider-store");
        const one = newStore();
        const two = newStore();
        let first;
        let second;
        await t.test("simultaneous initial saves retain both encrypted keys", async () => {
            synchronizeNextReads();
            [first, second] = await Promise.all([
                one.saveProviderConnection({ providerId: "google-ai-studio", label: "First", secret: "synthetic-first-key" }),
                two.saveProviderConnection({ providerId: "google-ai-studio", label: "Second", secret: "synthetic-second-key" }),
            ]);
            assert.equal((await one.listProviderConnections()).length, 2);
            assert.ok(conflicts >= 1, "the test must exercise the lost-update conflict");
            const raw = await exec("SELECT payload::text FROM provider_runtime_config;");
            assert.ok(!raw.includes("synthetic-first-key") && !raw.includes("synthetic-second-key"));
            assert.equal((await newStore().getProviderConnection(first.id)).secret, "synthetic-first-key");
            assert.equal((await newStore().getProviderConnection(second.id)).secret, "synthetic-second-key");
            assert.ok(!JSON.stringify(await one.listProviderConnections()).includes("secretCiphertext"));
        });
        await t.test("model and connection updates cannot overwrite each other", async () => {
            synchronizeNextReads();
            await Promise.all([
                one.saveProviderConnection({ id: first.id, providerId: "google-ai-studio", label: "Renamed", enabled: false }),
                two.setBuiltInModelEnabled(builtInModel.id, "image", false),
            ]);
            const connections = await newStore().listProviderConnections();
            assert.equal(connections.find(entry => entry.id === first.id).label, "Renamed");
            assert.equal(connections.find(entry => entry.id === first.id).enabled, false);
            assert.equal((await newStore().listModelOverrides())[0].enabled, false);
            assert.equal((await newStore().getProviderConnection(second.id)).secret, "synthetic-second-key");
        });
        await t.test("partial updates to the same connection preserve independent fields", async () => {
            synchronizeNextReads();
            await Promise.all([
                one.saveProviderConnection({ id: second.id, providerId: "google-ai-studio", label: "Updated label" }),
                two.saveProviderConnection({ id: second.id, providerId: "google-ai-studio", priority: 7 }),
            ]);
            const saved = (await newStore().listProviderConnections()).find(entry => entry.id === second.id);
            assert.equal(saved.label, "Updated label");
            assert.equal(saved.priority, 7);
        });
        await t.test("delete and discovery updates do not resurrect deleted credentials", async () => {
            synchronizeNextReads();
            await Promise.all([
                one.deleteProviderConnection(first.id),
                two.saveDiscoveredModels("google-ai-studio", [{ providerModelId: "synthetic-image", mediaType: "image" }]),
            ]);
            assert.equal(await newStore().getProviderConnection(first.id), undefined);
            assert.equal((await newStore().listProviderConnections()).length, 1);
            assert.equal((await newStore().listDiscoveredModels()).length, 1);
        });
        await t.test("legacy documents normalize without preventing optimistic saves", async () => {
            await exec("UPDATE provider_runtime_config SET payload = payload - 'discoveredModels';");
            await one.setBuiltInModelEnabled(builtInModel.id, "image", true);
            assert.equal((await newStore().listModelOverrides())[0].enabled, true);
        });
        await t.test("persistent conflicts are bounded and never report a successful save", async () => {
            let attempts = 0;
            const busy = newStore(async (statement, values) => {
                if (statement.startsWith("INSERT INTO provider_runtime_config")) { attempts++; return []; }
                return query(statement, values);
            });
            await assert.rejects(busy.deleteProviderConnection(second.id), /ERR_PROVIDER_CONFIG_CONFLICT/);
            assert.equal(attempts, 5);
            assert.ok(await newStore().getProviderConnection(second.id));
        });
        await t.test("an unsupported schema rejects writes", async () => {
            await exec("UPDATE provider_runtime_config_schema SET version = 2;");
            await assert.rejects(newStore().deleteProviderConnection(second.id), /ERR_PROVIDER_CONFIG_SCHEMA_REQUIRED/);
        });
    } finally { await psql(`DROP SCHEMA ${schema} CASCADE;`); }
});
