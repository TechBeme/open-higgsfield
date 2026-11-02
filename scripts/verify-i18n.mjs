import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTranslator } from "next-intl";
import { createModuleLoader } from "./test-module-loader.mjs";

const modules = createModuleLoader();
const { locales, defaultLocale } = modules.load("src/i18n/locales.ts");
const { catalogTextKey, catalogText, modelCopyKey, localizeSchema } = modules.load("src/i18n/catalog-copy.ts");
const messages = Object.fromEntries(locales.map(locale => [locale, JSON.parse(readFileSync(new URL(`../src/messages/${locale}.json`, import.meta.url), "utf8"))]));
const models = [
    ...Object.values(modules.load("src/server/catalog/image.ts").IMAGE_CAPABILITIES),
    ...Object.values(modules.load("src/server/catalog/video.ts").VIDEO_CAPABILITIES),
].filter(model => !model.deprecated);
const plain = value => JSON.parse(JSON.stringify(value));
const translator = (locale, namespace) => createTranslator({ locale, messages: messages[locale], namespace, onError: error => { throw error; } });

function flatten(object, prefix = "", result = {}) {
    for (const [key, value] of Object.entries(object)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === "object") flatten(value, path, result);
        else result[path] = value;
    }
    return result;
}

function visitDocumentation(value, visit) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
        if ((key === "description" || key === "title") && typeof child === "string") visit(child);
        else if (typeof child === "object") visitDocumentation(child, visit);
    }
}

test("English, Portuguese and Spanish have identical, nonempty message keys and valid ICU arguments", () => {
    assert.deepEqual(plain(locales), ["en", "pt-BR", "es"]);
    const reference = flatten(messages.en);
    const argumentsOf = message => [...message.matchAll(/\{(\w+)(?:,|\})/g)].map(match => match[1]).sort();
    for (const locale of locales) {
        const flat = flatten(messages[locale]);
        assert.deepEqual(Object.keys(reference).filter(key => !(key in flat)), [], `${locale}: missing keys`);
        assert.deepEqual(Object.keys(flat).filter(key => !(key in reference)), [], `${locale}: unexpected keys`);
        const t = translator(locale);
        for (const [key, value] of Object.entries(flat)) {
            assert.equal(typeof value, "string", `${locale}.${key}`);
            assert.ok(value.trim(), `${locale}.${key} is empty`);
            // Provider documentation is literal text, including JSON braces, not ICU.
            if (key.startsWith("catalog.")) { assert.equal(t.raw(key), value); continue; }
            assert.deepEqual(argumentsOf(value), argumentsOf(reference[key]), `${locale}.${key} placeholders`);
            for (const count of [0, 1, 2, 21]) {
                const args = Object.fromEntries(argumentsOf(value).map(name => [name, count]));
                assert.ok(t(key, args).length > 0, `${locale}.${key} must render`);
            }
        }
    }
});

test("every built-in model, parameter, reference, option and schema description has all three translations", () => {
    assert.ok(models.length >= 367, "The complete catalog must be loaded");
    const sourceByKey = new Map();
    function checkCatalog(section, source) {
        const key = catalogTextKey(source);
        const normalized = source.trim().replace(/\s+/g, " ");
        const previous = sourceByKey.get(key);
        assert.ok(!previous || previous === normalized, `Content-key collision: ${source}`);
        sourceByKey.set(key, normalized);
        for (const locale of locales) {
            const t = translator(locale, "catalog");
            assert.ok(t.has(`${section}.${key}`), `${locale} missing ${section}: ${source}`);
            const value = catalogText(t, section, source);
            assert.ok(value.trim());
            if (section === "descriptions" && locale !== "en") assert.notEqual(value, source, `${locale}: untranslated description ${source}`);
            if (section === "models" && locale !== "en" && /(?:^| - )(?:Create |Edit |Generate |Transform |Upscale |Apply |Enhance |Adjust |Video transition|Motion control|Remove the |Lip-sync video)/.test(source)) {
                assert.notEqual(value, source, `${locale}: untranslated model action ${source}`);
            }
        }
    }
    for (const model of models) {
        checkCatalog("models", model.label);
        for (const locale of locales) {
            const labels = new Set();
            const t = translator(locale, "commandBar");
            for (const field of model.custom_fields) {
                const label = `${field.type}:${t(`fields.${modelCopyKey(field.id)}`)}:${Boolean(field.required)}`;
                assert.ok(!labels.has(label), `${locale}: ambiguous label in ${model.id} for ${field.id}`);
                labels.add(label);
            }
        }
        for (const [section, fields] of [["fields", model.custom_fields], ["slots", model.media_slots]]) {
            for (const field of fields) {
                for (const locale of locales) assert.ok(translator(locale, "commandBar").has(`${section}.${modelCopyKey(field.id)}`), `${locale}: missing ${section}.${field.id}`);
                for (const option of field.options ?? []) checkCatalog("options", option);
                visitDocumentation(field, source => checkCatalog("descriptions", source));
            }
        }
        for (const capability of [model, ...Object.values(model.variant_overrides ?? {})]) {
            for (const [, value] of capability.aspect_ratio?.options ?? []) {
                if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value)) checkCatalog("options", value);
            }
        }
    }
});

test("translated documentation preserves every schema constraint, canonical value and custom user text", () => {
    const t = translator("es", "catalog");
    function stripDocumentation(value) {
        if (Array.isArray(value)) return value.map(stripDocumentation);
        if (!value || typeof value !== "object") return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "description" && key !== "title").map(([key, child]) => [key, stripDocumentation(child)]));
    }
    for (const model of models) {
        for (const field of model.custom_fields) {
            if (!field.schema) continue;
            const before = JSON.stringify(field.schema);
            const localized = localizeSchema(field.schema, text => catalogText(t, "descriptions", text));
            assert.deepEqual(plain(stripDocumentation(localized)), plain(stripDocumentation(field.schema)));
            assert.equal(JSON.stringify(field.schema), before, "Never mutate provider contracts");
        }
    }
    const schema = { type: "object", properties: { title: { type: "string", description: "Help" }, description: { const: "title" } }, required: ["title"], enum: [{ title: "literal" }], default: { description: "literal" } };
    assert.deepEqual(plain(localizeSchema(schema, () => "Ayuda")), { ...schema, properties: { title: { type: "string", description: "Ayuda" }, description: { const: "title" } } });
    for (const section of ["models", "options", "descriptions"]) assert.equal(catalogText(t, section, "My custom text {literal}"), "My custom text {literal}");
    const literal = "{value} and <tag> are provider examples";
    assert.equal(catalogText({ has: () => true, raw: () => literal }, "descriptions", "example"), literal);
    assert.equal(catalogTextKey("  Example\n  text "), catalogTextKey("Example text"));
});

test("localized manifests and sitemap agree with locale routes and reject unknown locales", async () => {
    const { localizedManifest } = modules.load("src/i18n/metadata.ts");
    const routeModules = createModuleLoader({ mocks: { "next-intl/server": { getTranslations: async ({ locale, namespace }) => translator(locale, namespace) } } });
    const { GET } = routeModules.load("src/app/[locale]/manifest.webmanifest/route.ts");
    for (const locale of locales) {
        const t = translator(locale, "metadata");
        const manifest = localizedManifest(locale, t);
        assert.equal(manifest.lang, locale);
        assert.equal(manifest.start_url, `/${locale}`);
        assert.equal(manifest.description, messages[locale].metadata.description);
        assert.equal(manifest.id, "/", "One installable app across all languages");
        const response = await GET(new Request(`https://example.test/${locale}/manifest.webmanifest`), { params: Promise.resolve({ locale }) });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /application\/manifest\+json/);
        assert.match(response.headers.get("cache-control"), /no-store/);
        assert.deepEqual(await response.json(), plain(manifest));
    }
    assert.equal((await GET(new Request("https://example.test/fr/manifest.webmanifest"), { params: Promise.resolve({ locale: "fr" }) })).status, 404);
    const compatibility = await routeModules.load("src/app/manifest.webmanifest/route.ts").GET();
    assert.equal((await compatibility.json()).lang, defaultLocale);
    const sitemap = modules.load("src/app/sitemap.ts").default();
    assert.equal(sitemap.length, locales.length);
    for (const entry of sitemap) assert.deepEqual(Object.keys(entry.alternates.languages).sort(), [...locales].sort());
    assert.equal(defaultLocale, "pt-BR");
});
