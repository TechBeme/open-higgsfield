import { spawn, execFileSync } from "node:child_process";
import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { Agent, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { connect, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const origin = "https://127.0.0.1:3110";
const production = process.env.E2E_PRODUCTION !== "0";
const temporary = await mkdtemp(path.join(tmpdir(), "open-higgsfield-e2e-"));
const sockets = new Set();
let server, child, childEnded, shuttingDown = false;
const upstreamAgent = new Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 4 });
const expectedDisconnect = error => ["ECONNRESET", "EPIPE", "ERR_STREAM_PREMATURE_CLOSE"].includes(error?.code);

function track(socket) {
    if (sockets.has(socket)) return socket;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    return socket;
}

function signalChild(signal) {
    if (!child?.pid) return;
    try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
    } catch (error) { if (error.code !== "ESRCH") console.error("[E2E] Failed to stop child:", error.code); }
}

async function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    const serverClosed = server?.listening ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
    for (const socket of sockets) socket.destroy();
    upstreamAgent.destroy();
    signalChild("SIGTERM");
    if (childEnded) {
        const timeout = setTimeout(() => signalChild("SIGKILL"), 4000);
        await childEnded;
        clearTimeout(timeout);
        signalChild("SIGKILL");
    }
    await serverClosed;
    await rm(temporary, { recursive: true, force: true });
    process.exit(code);
}

process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));

function upstreamHeaders(request, upgrade = false) {
    const hopByHop = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
    const headers = Object.fromEntries(Object.entries(request.headers).filter(([key]) => !hopByHop.has(key.toLowerCase())));
    if (upgrade) { headers.connection = "Upgrade"; headers.upgrade = request.headers.upgrade; }
    return { ...headers, host: "127.0.0.1:3110", "x-forwarded-host": "127.0.0.1:3110",
        "x-forwarded-proto": "https", "x-forwarded-port": "3110", "x-forwarded-for": "127.0.0.1" };
}

async function assertBackendPortFree() {
    const probe = createNetServer();
    await new Promise((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(3111, "127.0.0.1", () => probe.close(resolve));
    });
}

async function nextArguments() {
    const cli = path.join(root, "node_modules/next/dist/bin/next");
    if (!production) return [cli, "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3111"];
    let build;
    try { build = JSON.parse(await readFile(path.join(root, ".next/required-server-files.json"), "utf8")); }
    catch { throw new Error("E2E production build is missing or invalid. Run npm run build first."); }
    if (build.config?.output !== "standalone") return [cli, "start", "--hostname", "127.0.0.1", "--port", "3111"];
    const standalone = path.join(root, ".next/standalone"), entry = path.join(standalone, "server.js");
    await access(entry);
    // Next's standalone output intentionally omits these CDN-ready assets.
    await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
    await cp(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
    return [entry];
}

try {
    await assertBackendPortFree();
    const argumentsForNext = await nextArguments();
    const keyPath = path.join(temporary, "key.pem"), certPath = path.join(temporary, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
        "-keyout", keyPath, "-out", certPath, "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
    server = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (request, response) => {
        let upstreamResponse;
        response.once("error", error => {
            if (!expectedDisconnect(error)) console.error("[E2E] Proxy response error", error);
        });
        const upstream = httpRequest({ hostname: "127.0.0.1", port: 3111, path: request.url, method: request.method,
            headers: upstreamHeaders(request), agent: upstreamAgent }, incoming => {
            upstreamResponse = incoming;
            response.writeHead(incoming.statusCode ?? 502, incoming.headers);
            incoming.pipe(response);
            incoming.once("aborted", () => { if (!response.destroyed) response.destroy(); });
            incoming.once("error", error => { if (!response.destroyed) response.destroy(error); });
        });
        response.once("close", () => {
            // Also cancel requests whose upstream has not sent response headers yet.
            if (response.writableFinished) return;
            if (upstreamResponse?.complete) upstreamResponse.resume();
            else upstream.destroy();
        });
        upstream.once("socket", track);
        upstream.once("error", error => {
            if (expectedDisconnect(error) && (response.destroyed || response.writableEnded)) return;
            if (response.headersSent) response.destroy();
            else { response.writeHead(503, { "Content-Type": "text/plain" }); response.end("E2E server is starting"); }
        });
        request.once("aborted", () => { if (!upstream.writableEnded) upstream.destroy(); });
        request.once("error", error => { if (error.code !== "ECONNRESET") console.error("[E2E] Incoming proxy request error", error); upstream.destroy(); });
        request.pipe(upstream);
    });
    server.on("connection", track);
    server.on("secureConnection", track);
    // Preserve Next's development HMR channel through the local TLS proxy.
    server.on("upgrade", (request, socket, head) => {
        const upstream = track(connect(3111, "127.0.0.1", () => {
            const headers = Object.entries(upstreamHeaders(request, true)).flatMap(([key, value]) =>
                (Array.isArray(value) ? value : [value]).filter(value => value !== undefined).map(value => `${key}: ${value}`));
            upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
            if (head.length) upstream.write(head);
            socket.pipe(upstream).pipe(socket);
        }));
        upstream.once("error", () => socket.destroy());
        socket.once("error", () => upstream.destroy());
        socket.once("close", () => upstream.destroy());
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(3110, "127.0.0.1", resolve);
    });

    // Explicit empty values take precedence over local dotenv files loaded by Next.
    const environment = { ...process.env,
        NODE_ENV: production ? "production" : "development", NEXT_TELEMETRY_DISABLED: "1",
        HOSTNAME: "127.0.0.1", PORT: "3111",
        E2E_TEST_SERVER: "1", E2E_PRODUCTION: production ? "1" : "0",
        APP_ORIGIN: origin, APP_ACCESS_USER: "e2e-local", APP_ACCESS_PASSWORD: "synthetic-e2e-workspace-password-32-characters",
        PROVIDER_CONFIG_ENCRYPTION_KEY: "synthetic-e2e-encryption-key-32-characters",
        OPEN_HIGGSFIELD_STORAGE_DIR: path.join(temporary, "storage"), GENERATION_ENABLED: "false",
        DEPLOYMENT_PROFILE: "single-process", TASK_WORKER_MODE: "local", TASK_OBSERVATION_TIMEOUT_MS: "86400000",
        TASK_SCHEDULER_CONFIGURED: "false", ASSET_STORAGE_MODE: "local", ASSET_DELIVERY_MODE: "private",
        DATABASE_URL: "", VERCEL: "", VERCEL_ENV: "", VERCEL_OIDC_TOKEN: "", CRON_SECRET: "",
        CLOUDINARY_URL: "", CLOUDINARY_CLOUD_NAME: "", CLOUDINARY_API_KEY: "", CLOUDINARY_API_SECRET: "",
        GEMINI_API_KEY: "", GOOGLE_AI_API_KEY: "", GOOGLE_API_KEY: "", GOOGLE_APPLICATION_CREDENTIALS: "",
        GOOGLE_SERVICE_ACCOUNT_JSON: "", GOOGLE_CLOUD_CREDENTIALS: "", GOOGLE_CLOUD_PROJECT: "", GCLOUD_PROJECT: "",
        GOOGLE_CLOUD_LOCATION: "", GOOGLE_VEO_LOCATION: "", AI_GATEWAY_API_KEY: "", TOAPIS_API_KEY: "",
        TOAPIS_BASE_URL: "", MAGNIFIC_API_KEY: "", FREEPIK_API_KEY: "", NEXT_PHASE: "",
    };
    child = spawn(process.execPath, argumentsForNext, {
        cwd: root, env: environment, stdio: ["ignore", "inherit", "inherit"], detached: process.platform !== "win32",
    });
    childEnded = new Promise(resolve => {
        child.once("exit", code => { resolve(); if (!shuttingDown) { console.error("[E2E] Next exited before teardown."); void shutdown(code || 1); } });
        child.once("error", error => { resolve(); console.error("[E2E] Next could not start:", error.code); void shutdown(1); });
    });
    console.log(`[E2E] Isolated ${production ? "production" : "development"} workspace at ${origin}`);
} catch (error) {
    console.error("[E2E] Startup failed:", error.code ?? error.message);
    await shutdown(1);
}
