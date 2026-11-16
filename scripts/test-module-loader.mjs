import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const requireDependency = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

/** A fresh module graph/global per simulated process; real TS source, injectable boundaries. */
export function createModuleLoader({ mocks = {}, env = {}, globals = {}, platform = process.platform } = {}) {
    const cache = new Map();
    const context = vm.createContext({
        console, Buffer, URL, URLSearchParams, Response, Request, Headers, FormData, Blob, File,
        AbortSignal, AbortController, DOMException, TextEncoder, TextDecoder, ReadableStream,
        structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
        process: { env, cwd: () => root, pid: process.pid, platform }, ...globals,
    });
    context.global = context;
    function load(relative) {
        if (Object.hasOwn(mocks, relative)) return mocks[relative];
        let filename = relative.startsWith("@/") ? path.join(root, "src", relative.slice(2)) : path.resolve(root, relative);
        if (!path.extname(filename)) {
            filename = fs.existsSync(`${filename}.ts`) ? `${filename}.ts` : path.join(filename, "index.ts");
        }
        if (cache.has(filename)) return cache.get(filename).exports;
        const loaded = { exports: {} };
        cache.set(filename, loaded);
        const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
            fileName: filename,
        }).outputText;
        const resolve = (name) => {
            // The loader executes backend code outside Next's React Server environment.
            if (name === "server-only") return {};
            if (Object.hasOwn(mocks, name)) return mocks[name];
            if (name.startsWith("@/")) return load(name);
            if (name.startsWith(".")) return load(path.resolve(path.dirname(filename), name));
            return requireDependency(name);
        };
        const wrapper = vm.runInContext(`(function(require,module,exports,__filename,__dirname){${code}\n})`, context, { filename });
        wrapper(resolve, loaded, loaded.exports, filename, path.dirname(filename));
        return loaded.exports;
    }
    return { load, context, cache };
}

/** node:fs/promises as Windows behaves: directories open, but flushing their handle fails (FlushFileBuffers -> EPERM). */
export function windowsDirectoryFs() {
    return { ...fsPromises, open: async (...args) => {
        const handle = await fsPromises.open(...args);
        if ((await handle.stat()).isDirectory()) {
            handle.sync = async () => { throw Object.assign(new Error("EPERM: operation not permitted, fsync"), { code: "EPERM", syscall: "fsync" }); };
        }
        return handle;
    } };
}
