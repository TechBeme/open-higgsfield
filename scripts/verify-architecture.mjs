import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { builtinModules } from "node:module";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "src");
const files = fs.readdirSync(sourceRoot, { recursive: true }).filter(file => /\.(ts|tsx)$/.test(file));
const graph = new Map();
const serverDependencies = new Set(["@neondatabase/serverless", "@google/genai", "@ai-sdk/gateway", "ai", "sharp", "formidable"]);
const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));

for (const file of files) {
    const source = fs.readFileSync(path.join(sourceRoot, file), "utf8");
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports = [];
    const add = (specifier, typeOnly = false) => {
        const name = specifier.text;
        let target;
        if (name.startsWith("@/") || name.startsWith(".")) {
            const base = name.startsWith("@/") ? name.slice(2) : path.join(path.dirname(file), name);
            target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(candidate => files.includes(candidate));
            // CSS and JSON resources do not introduce runtime code dependencies.
            if (!target && !/\.(css|json)$/.test(name)) throw new Error(`Unresolved source import: ${file} -> ${name}`);
        }
        imports.push({ name, target, typeOnly });
    };
    const visit = node => {
        if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            const bindings = clause?.namedBindings;
            const typeOnly = clause?.isTypeOnly || (!clause?.name && bindings && ts.isNamedImports(bindings)
                && bindings.elements.length > 0 && bindings.elements.every(entry => entry.isTypeOnly));
            add(node.moduleSpecifier, Boolean(typeOnly));
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
            add(node.moduleSpecifier, node.isTypeOnly);
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
            add(node.arguments[0]);
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    graph.set(file, { imports, client: ast.statements.some(node => ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression) && node.expression.text === "use client") });
}

test("server modules declare Next's server-only boundary and never depend on product UI", () => {
    for (const [file, { imports }] of graph) {
        if (!file.startsWith("server/")) continue;
        assert.ok(imports.some(entry => entry.name === "server-only"), `${file} must declare its server boundary`);
        for (const { name, target } of imports) {
            assert.ok(!target || !/^(features|components|app)\//.test(target), `${file} imports presentation layer ${target}`);
            assert.ok(!["react", "react-dom", "swr"].includes(name), `${file} imports client state ${name}`);
        }
    }
});

test("client dependency graphs cannot reach credentials, catalogs, provider SDKs or Node builtins", () => {
    const visited = new Set();
    function visit(file, trail) {
        if (visited.has(file)) return;
        visited.add(file);
        assert.ok(!file.startsWith("server/"), `${trail.join(" -> ")} -> ${file}`);
        for (const { name, target, typeOnly } of graph.get(file).imports) {
            if (typeOnly) continue;
            assert.ok(name !== "server-only" && !builtins.has(name) && !serverDependencies.has(name), `${file} imports server runtime ${name}`);
            if (target) visit(target, [...trail, file]);
        }
    }
    for (const [file, module] of graph) if (module.client) visit(file, []);
});

test("shared contracts stay independent from server and feature implementations", () => {
    for (const [file, { imports }] of graph) {
        if (!/^(models|providers|types|lib)\//.test(file)) continue;
        for (const { target } of imports) {
            assert.ok(!target || !/^(server|features|components|app)\//.test(target), `${file} couples a shared contract to ${target}`);
        }
    }
});

test("every product component is reachable from a Next route or layout", () => {
    const reachable = new Set();
    function visit(file) {
        if (reachable.has(file)) return;
        reachable.add(file);
        for (const { target } of graph.get(file).imports) if (target) visit(target);
    }
    for (const file of files) if (file.startsWith("app/")) visit(file);
    for (const file of files) {
        if ((file.startsWith("features/") || file.startsWith("components/layout/")) && file.endsWith(".tsx")) {
            assert.ok(reachable.has(file), `Unreachable product component: ${file}`);
        }
    }
});
