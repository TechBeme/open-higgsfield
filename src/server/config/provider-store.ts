import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { STORAGE_ROOT } from "@/server/config/storage-paths";
import type { ModelCapabilities } from "@/models/capabilities/types";
import { isProviderId, PROVIDER_DEFINITIONS } from "@/providers/definitions";
import type { ProviderConnectionContext, ProviderId } from "@/providers/types";
import { assertCustomModelCapabilities, hasBuiltInCapability } from "@/server/catalog/custom-validation";

const CONFIG_FILE = path.join(STORAGE_ROOT, "provider-runtime-config.json");
const MAX_SECRET_LENGTH = 32_768;
const MAX_METADATA_BYTES = 16_384;
const MAX_CAPABILITY_BYTES = 128_000;

import type { ProviderConnectionRecord, ModelOverride, DiscoveredModelRecord } from "@/providers/config-types";

interface StoredConnection extends Omit<ProviderConnectionRecord, "secretConfigured"> {
    secretCiphertext?: string;
}

interface StoredConfig {
    version: 1;
    connections: StoredConnection[];
    modelOverrides: ModelOverride[];
    discoveredModels: DiscoveredModelRecord[];
}

const emptyConfig = (): StoredConfig => ({ version: 1, connections: [], modelOverrides: [], discoveredModels: [] });
let sqlClient: NeonQueryFunction<false, false> | undefined;
let dbSchemaVerified = false;
const shared = globalThis as typeof globalThis & { __providerConfigReady?: Promise<void>; __providerConfigQueue?: Promise<unknown> };
const selectionCursors = new Map<ProviderId, number>();

function databaseConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL) && process.env.NEXT_PHASE !== "phase-production-build";
}

function encryptionKey(): Buffer {
    const raw = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
    if (!raw || raw.length < 32 || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error("ERR_PROVIDER_CONFIG_ENCRYPTION_KEY_REQUIRED");
    return createHash("sha256").update(raw).digest();
}

function encryptSecret(secret: string): string {
    if (!secret || secret.length > MAX_SECRET_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(secret)) throw new Error("ERR_PROVIDER_SECRET_INVALID");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function decryptSecret(ciphertext: string): string {
    const [ivRaw, tagRaw, dataRaw] = ciphertext.split(".");
    if (!ivRaw || !tagRaw || !dataRaw) throw new Error("ERR_PROVIDER_SECRET_CORRUPT");
    try {
        const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
        decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(dataRaw, "base64url")), decipher.final()]).toString("utf8");
    } catch { throw new Error("ERR_PROVIDER_SECRET_CORRUPT"); }
}

function normalizeConfig(value: unknown): StoredConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ERR_PROVIDER_CONFIG_CORRUPT");
    const input = value as Partial<StoredConfig>;
    if (input.version !== 1 || !Array.isArray(input.connections) || !Array.isArray(input.modelOverrides)) throw new Error("ERR_PROVIDER_CONFIG_CORRUPT");
    return {
        version: 1,
        connections: input.connections.filter((entry): entry is StoredConnection => Boolean(entry && typeof entry === "object" && typeof (entry as StoredConnection).id === "string")),
        modelOverrides: input.modelOverrides.filter((entry): entry is ModelOverride => Boolean(entry && typeof entry === "object" && typeof (entry as ModelOverride).modelId === "string")),
        discoveredModels: Array.isArray(input.discoveredModels) ? input.discoveredModels.filter((entry): entry is DiscoveredModelRecord => Boolean(entry && typeof entry === "object" && typeof (entry as DiscoveredModelRecord).providerModelId === "string")) : [],
    };
}

async function query(statement: string, values: unknown[] = []): Promise<Record<string, unknown>[]> {
    sqlClient ??= neon(process.env.DATABASE_URL!);
    return sqlClient.query(statement, values);
}

async function readDatabaseConfig(): Promise<{ config: StoredConfig; previousPayload: string | null }> {
    if (!dbSchemaVerified) {
        try {
            const rows = await query("SELECT version FROM provider_runtime_config_schema WHERE singleton = TRUE");
            if (rows[0]?.version !== 1) throw new Error();
        } catch { throw new Error("ERR_PROVIDER_CONFIG_SCHEMA_REQUIRED"); }
        dbSchemaVerified = true;
    }
    const rows = await query("SELECT payload FROM provider_runtime_config WHERE singleton = TRUE");
    return rows[0]
        ? { config: normalizeConfig(rows[0].payload), previousPayload: JSON.stringify(rows[0].payload) }
        : { config: emptyConfig(), previousPayload: null };
}

async function readConfig(): Promise<StoredConfig> {
    if (databaseConfigured()) return (await readDatabaseConfig()).config;
    shared.__providerConfigReady ??= (async () => {
        try {
            const raw = await fs.readFile(CONFIG_FILE, "utf8");
            normalizeConfig(JSON.parse(raw));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    })().catch((error) => { shared.__providerConfigReady = undefined; throw error; });
    await shared.__providerConfigReady;
    try { return normalizeConfig(JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig(); throw new Error("ERR_PROVIDER_CONFIG_CORRUPT"); }
}

async function writeLocalConfig(config: StoredConfig): Promise<void> {
    const serialized = JSON.stringify(config);
    await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
    const temp = `${CONFIG_FILE}.${randomUUID()}.tmp`;
    try {
        const handle = await fs.open(temp, "wx", 0o600);
        try { await handle.writeFile(serialized, "utf8"); await handle.sync(); }
        finally { await handle.close(); }
        await fs.rename(temp, CONFIG_FILE);
    } catch (error) { await fs.unlink(temp).catch(() => undefined); throw error; }
}

async function mutate<T>(fn: (config: StoredConfig) => T): Promise<T> {
    const pending = (shared.__providerConfigQueue ?? Promise.resolve()).then(async () => {
        if (databaseConfigured()) {
            // A local queue cannot serialize different workers. Retry the mutation against the latest committed document.
            for (let attempt = 0; attempt < 5; attempt++) {
                const { config, previousPayload } = await readDatabaseConfig();
                const result = fn(config);
                const rows = await query(`INSERT INTO provider_runtime_config (singleton, version, payload)
                    VALUES (TRUE, 1, $1::jsonb)
                    ON CONFLICT (singleton) DO UPDATE SET version = 1, payload = EXCLUDED.payload, updated_at = NOW()
                    WHERE provider_runtime_config.payload = $2::jsonb
                    RETURNING singleton`, [JSON.stringify(config), previousPayload]);
                if (rows.length) return result;
            }
            throw new Error("ERR_PROVIDER_CONFIG_CONFLICT");
        }
        const config = await readConfig();
        const result = fn(config);
        await writeLocalConfig(config);
        return result;
    });
    shared.__providerConfigQueue = pending.catch(() => undefined);
    return pending;
}

function redactedConnection(entry: StoredConnection): ProviderConnectionRecord {
    const { secretCiphertext, ...publicEntry } = entry;
    return { ...publicEntry, secretConfigured: Boolean(secretCiphertext) };
}

function validateMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || Buffer.byteLength(JSON.stringify(metadata)) > MAX_METADATA_BYTES) throw new Error("ERR_PROVIDER_METADATA_INVALID");
    return structuredClone(metadata);
}

export async function listProviderConnections(): Promise<ProviderConnectionRecord[]> {
    let config: StoredConfig;
    try { config = await readConfig(); } catch (error) { if (error instanceof Error && error.message === "ERR_PROVIDER_CONFIG_SCHEMA_REQUIRED") return []; throw error; }
    return config.connections.filter((entry) => isProviderId(entry.providerId)).map(redactedConnection).sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
}

/** Saved connections take precedence over environment credentials, including disabling all keys. */
export async function getConnectedProviderIds(): Promise<Set<ProviderId>> {
    const connections = await listProviderConnections();
    return new Set(PROVIDER_DEFINITIONS.filter(({ id }) => {
        const saved = connections.filter((entry) => entry.providerId === id);
        return saved.length ? saved.some((entry) => entry.enabled && entry.secretConfigured) : Boolean(connectionFromEnv(id));
    }).map(({ id }) => id));
}

export async function getProviderConnection(id: string): Promise<ProviderConnectionContext | undefined> {
    if (id.startsWith("env:")) {
        const providerId = id.slice(4);
        return isProviderId(providerId) ? connectionFromEnv(providerId) : undefined;
    }
    let config: StoredConfig;
    try { config = await readConfig(); } catch (error) { if (error instanceof Error && error.message === "ERR_PROVIDER_CONFIG_SCHEMA_REQUIRED") return undefined; throw error; }
    const entry = config.connections.find((candidate) => candidate.id === id && candidate.enabled && isProviderId(candidate.providerId));
    if (!entry) return undefined;
    return { id: entry.id, providerId: entry.providerId, secret: entry.secretCiphertext ? decryptSecret(entry.secretCiphertext) : undefined, metadata: structuredClone(entry.metadata) };
}

export async function selectProviderConnection(providerId: ProviderId): Promise<ProviderConnectionContext | undefined> {
    if (!isProviderId(providerId)) return undefined;
    let config: StoredConfig;
    try { config = await readConfig(); } catch (error) { if (error instanceof Error && error.message === "ERR_PROVIDER_CONFIG_SCHEMA_REQUIRED") return undefined; throw error; }
    return selectSavedConnection(config, providerId);
}

/** A saved configuration is authoritative; never bypass disabled or unreadable keys with .env. */
export async function resolveProviderConnection(providerId: ProviderId): Promise<ProviderConnectionContext | undefined> {
    if (!isProviderId(providerId)) throw new Error("ERR_UNKNOWN_PROVIDER");
    const config = await readConfig();
    if (!config.connections.some(entry => entry.providerId === providerId)) return connectionFromEnv(providerId);
    const connection = selectSavedConnection(config, providerId);
    if (!connection) throw new Error("ERR_PROVIDER_CONNECTION_NOT_CONFIGURED");
    return connection;
}

function selectSavedConnection(config: StoredConfig, providerId: ProviderId): ProviderConnectionContext | undefined {
    const candidates = config.connections.filter((candidate) => candidate.providerId === providerId && candidate.enabled && candidate.secretCiphertext && candidate.lastHealth !== "unhealthy")
        .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
    const fallback = candidates.length ? candidates : config.connections.filter((candidate) => candidate.providerId === providerId && candidate.enabled && candidate.secretCiphertext)
        .sort((a, b) => a.priority - b.priority || a.createdAt.localeCompare(b.createdAt));
    const bestPriority = fallback[0]?.priority;
    const eligible = bestPriority === undefined ? [] : fallback.filter((candidate) => candidate.priority === bestPriority);
    const cursor = selectionCursors.get(providerId) ?? 0;
    const entry = eligible.length ? eligible[cursor % eligible.length] : undefined;
    if (eligible.length) selectionCursors.set(providerId, cursor + 1);
    return entry ? { id: entry.id, providerId: entry.providerId, secret: decryptSecret(entry.secretCiphertext!), metadata: structuredClone(entry.metadata) } : undefined;
}

export async function saveProviderConnection(input: { id?: string; providerId: ProviderId; label?: string; secret?: string; metadata?: Record<string, unknown>; enabled?: boolean; priority?: number }): Promise<ProviderConnectionRecord> {
    if (!isProviderId(input.providerId)) throw new Error("ERR_PROVIDER_CONNECTION_INVALID");
    return mutate((config) => {
        const now = new Date().toISOString();
        const existing = input.id ? config.connections.find((candidate) => candidate.id === input.id) : undefined;
        if (input.id && !existing) throw new Error("ERR_PROVIDER_CONNECTION_NOT_FOUND");
        if (existing && existing.providerId !== input.providerId) throw new Error("ERR_PROVIDER_CONNECTION_PROVIDER_MISMATCH");
        const label = input.label?.trim() ?? existing?.label;
        if (!label || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) throw new Error("ERR_PROVIDER_LABEL_INVALID");
        const secretCiphertext = input.secret?.trim() ? encryptSecret(input.secret.trim()) : existing?.secretCiphertext;
        if (!secretCiphertext) throw new Error("ERR_PROVIDER_SECRET_REQUIRED");
        const entry: StoredConnection = {
            id: existing?.id ?? `conn_${randomUUID()}`,
            providerId: input.providerId,
            label,
            enabled: input.enabled ?? existing?.enabled ?? true,
            priority: Number.isInteger(input.priority) && (input.priority as number) >= 0 && (input.priority as number) <= 10_000 ? input.priority as number : existing?.priority ?? 100,
            metadata: validateMetadata(input.metadata ?? existing?.metadata ?? {}),
            secretCiphertext,
            lastHealth: existing?.lastHealth ?? "unknown",
            lastHealthAt: existing?.lastHealthAt,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        if (existing) config.connections = config.connections.map((candidate) => candidate.id === entry.id ? entry : candidate);
        else config.connections.push(entry);
        return redactedConnection(entry);
    });
}

export async function deleteProviderConnection(id: string): Promise<boolean> {
    return mutate((config) => {
        const before = config.connections.length;
        config.connections = config.connections.filter((entry) => entry.id !== id);
        return before !== config.connections.length;
    });
}

export async function markProviderConnectionHealth(id: string, health: "healthy" | "unhealthy"): Promise<void> {
    await mutate((config) => {
        const entry = config.connections.find((candidate) => candidate.id === id);
        if (entry) { entry.lastHealth = health; entry.lastHealthAt = new Date().toISOString(); entry.updatedAt = new Date().toISOString(); }
    });
}

export async function listModelOverrides(): Promise<ModelOverride[]> {
    let config: StoredConfig;
    try { config = await readConfig(); } catch (error) { if (error instanceof Error && error.message === "ERR_PROVIDER_CONFIG_SCHEMA_REQUIRED") return []; throw error; }
    const overrides = config.modelOverrides.filter((entry) => entry.source !== "custom" || (entry.capabilities as { provider?: unknown } | undefined)?.provider !== "freepik");
    for (const entry of overrides) {
        if (entry.source !== "custom") continue;
        try {
            if ((entry.mediaType !== "image" && entry.mediaType !== "video") || typeof entry.enabled !== "boolean") throw new Error();
            assertCustomModelCapabilities(entry.capabilities, entry.mediaType, entry.modelId);
        } catch { throw new Error("ERR_PROVIDER_CONFIG_CORRUPT"); }
    }
    return structuredClone(overrides);
}

export async function listDiscoveredModels(): Promise<DiscoveredModelRecord[]> {
    let config: StoredConfig;
    try { config = await readConfig(); } catch (error) { if (error instanceof Error && error.message === "ERR_PROVIDER_CONFIG_SCHEMA_REQUIRED") return []; throw error; }
    return structuredClone(config.discoveredModels.filter((entry) => isProviderId(entry.providerId)));
}

export async function saveDiscoveredModels(providerId: ProviderId, models: Array<{ providerModelId: string; displayName?: string; mediaType?: "image" | "video" | "unknown" }>): Promise<DiscoveredModelRecord[]> {
    return mutate((config) => {
        const now = new Date().toISOString();
        for (const model of models.slice(0, 500)) {
            if (!/^[A-Za-z0-9_.:/-]{1,200}$/.test(model.providerModelId)) continue;
            const existing = config.discoveredModels.find((entry) => entry.providerId === providerId && entry.providerModelId === model.providerModelId);
            if (existing) { existing.displayName = model.displayName ?? existing.displayName; existing.mediaType = model.mediaType ?? existing.mediaType; existing.discoveredAt = now; }
            else config.discoveredModels.push({ id: `discovered_${randomUUID()}`, providerId, providerModelId: model.providerModelId, displayName: model.displayName, mediaType: model.mediaType ?? "unknown", status: "unverified", discoveredAt: now });
        }
        return structuredClone(config.discoveredModels.filter((entry) => entry.providerId === providerId));
    });
}

export async function setBuiltInModelEnabled(modelId: string, mediaType: "image" | "video", enabled: boolean): Promise<void> {
    await mutate((config) => {
        const existing = config.modelOverrides.find((entry) => entry.modelId === modelId && entry.mediaType === mediaType);
        if (!hasBuiltInCapability(mediaType, modelId) && existing?.source !== "custom") throw new Error("ERR_MODEL_PREFERENCE_INVALID");
        if (existing) { existing.enabled = enabled; existing.status = enabled ? existing.status === "disabled" ? "unverified" : existing.status : "disabled"; existing.updatedAt = new Date().toISOString(); }
        else config.modelOverrides.push({ modelId, mediaType, enabled, source: "discovered", status: enabled ? "verified" : "disabled", capabilities: {} as ModelCapabilities, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    });
}

export async function saveCustomModel(input: { modelId?: string; mediaType: "image" | "video"; capabilities: ModelCapabilities; enabled?: boolean }): Promise<ModelOverride> {
    const capabilities = structuredClone(input.capabilities);
    if (!capabilities || Buffer.byteLength(JSON.stringify(capabilities)) > MAX_CAPABILITY_BYTES) throw new Error("ERR_CUSTOM_MODEL_INVALID");
    assertCustomModelCapabilities(capabilities, input.mediaType, input.modelId);
    return mutate((config) => {
        const now = new Date().toISOString();
        const existing = config.modelOverrides.find((entry) => entry.modelId === capabilities.id && entry.mediaType === input.mediaType);
        const entry: ModelOverride = { modelId: capabilities.id, mediaType: input.mediaType, enabled: input.enabled ?? existing?.enabled ?? false, source: "custom", status: "unverified", capabilities: { ...capabilities, catalog_source: "custom", catalog_status: "unverified" }, createdAt: existing?.createdAt ?? now, updatedAt: now };
        if (existing) config.modelOverrides = config.modelOverrides.map((candidate) => candidate.modelId === entry.modelId && candidate.mediaType === entry.mediaType ? entry : candidate);
        else config.modelOverrides.push(entry);
        return structuredClone(entry);
    });
}

export async function deleteCustomModel(modelId: string, mediaType: "image" | "video"): Promise<boolean> {
    return mutate((config) => {
        const before = config.modelOverrides.length;
        config.modelOverrides = config.modelOverrides.filter((entry) => !(entry.modelId === modelId && entry.mediaType === mediaType && entry.source === "custom"));
        return before !== config.modelOverrides.length;
    });
}

export function connectionFromEnv(providerId: ProviderId): ProviderConnectionContext | undefined {
    if (!isProviderId(providerId)) return undefined;
    const key = providerId === "google-ai-studio" ? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY
        : providerId === "google-vertex" ? process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_CLOUD_CREDENTIALS
            : providerId === "vercel-ai-gateway" ? process.env.AI_GATEWAY_API_KEY
                : providerId === "toapis" ? process.env.TOAPIS_API_KEY
                    : providerId === "magnific" ? process.env.MAGNIFIC_API_KEY : undefined;
    if (!key?.trim()) return undefined;
    const metadata: Record<string, unknown> = {};
    if (providerId === "google-vertex") { metadata.project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT; metadata.location = process.env.GOOGLE_CLOUD_LOCATION; metadata.veoLocation = process.env.GOOGLE_VEO_LOCATION; }
    if (providerId === "toapis") metadata.origin = process.env.TOAPIS_BASE_URL;
    return { id: `env:${providerId}`, providerId, secret: key, metadata };
}
