import { test as base, expect, type Page } from "@playwright/test";
import type { ProviderConnectionRecord } from "../../src/providers/config-types";
import type { ProviderDefinition } from "../../src/providers/definitions";
import type { CatalogResponse } from "../../src/features/providers/types";
import type { AnyTask } from "../../src/types";

export const test = base.extend<{ browserErrors: string[] }>({
    browserErrors: [async ({ page }, use) => {
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => {
            // Intentional HTTP failures are asserted by each test; React errors must still fail.
            if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) errors.push(message.text());
        });
        await use(errors);
        expect(errors, "No hydration, render or unhandled-promise errors").toEqual([]);
    }, { auto: true }],
});

export { expect };

export interface MockWorkspace {
    providers: ProviderDefinition[];
    catalog: CatalogResponse;
    connectedProviderIds: string[];
    connections: ProviderConnectionRecord[];
    modelsError: boolean;
    providersError: boolean;
    catalogError: boolean;
    historyError: boolean;
    history: AnyTask[];
    nextCursor: string | null;
    requests: Array<{ method: string; path: string; body: string | null }>;
}

export async function mockWorkspace(page: Page, { connected = true }: { connected?: boolean } = {}): Promise<MockWorkspace> {
    const [providersResponse, catalogResponse] = await Promise.all([
        page.request.get("/api/providers"), page.request.get("/api/catalog"),
    ]);
    expect(providersResponse.ok()).toBeTruthy();
    expect(catalogResponse.ok()).toBeTruthy();
    const providers = (await providersResponse.json()).providers as ProviderDefinition[];
    const catalog = await catalogResponse.json() as CatalogResponse;
    const state: MockWorkspace = {
        providers, catalog: { ...catalog, overrides: [], discovered: [] },
        connectedProviderIds: connected ? providers.map(provider => provider.id) : [],
        connections: [], modelsError: false, providersError: false, catalogError: false,
        historyError: false, history: [], nextCursor: null, requests: [],
    };
    await page.route("**/api/**", async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        state.requests.push({ method, path: url.pathname + url.search, body: request.postData() });
        const unavailable = () => route.fulfill({ status: 503, json: { error: "ERR_PROVIDER_CONFIG_UNAVAILABLE" } });
        if (method !== "GET") return route.fulfill({ status: 400, json: { error: "ERR_INVALID_FIELD_VALUES", accepted: false, recovery_required: false } });
        switch (url.pathname) {
            case "/api/providers":
                return state.providersError ? unavailable() : route.fulfill({ json: { providers: state.providers, connections: state.connections, connectedProviderIds: state.connectedProviderIds, environmentProviderIds: [] } });
            case "/api/catalog":
                return state.catalogError ? unavailable() : route.fulfill({ json: state.catalog });
            case "/api/image-models":
                return state.modelsError ? unavailable() : route.fulfill({ json: { models: state.catalog.images.filter(model => state.connectedProviderIds.includes(model.provider)), groups: [] } });
            case "/api/models":
                return state.modelsError ? unavailable() : route.fulfill({ json: { models: {}, model_list: state.catalog.videos.filter(model => state.connectedProviderIds.includes(model.provider)), groups: [] } });
            case "/api/tasks":
            case "/api/image-tasks":
                return state.historyError ? unavailable() : route.fulfill({ json: { tasks: state.history, nextCursor: state.nextCursor } });
            default:
                return route.fulfill({ status: 400, json: { error: "ERR_SYNTHETIC_UNEXPECTED_REQUEST" } });
        }
    });
    return state;
}

export async function expectWithinViewport(page: Page) {
    await expect.poll(() => page.evaluate(() => {
        const panels = Array.from(document.querySelectorAll('[data-slot="dialog-content"], [data-slot="popover-content"]'));
        return document.documentElement.scrollWidth <= innerWidth + 1 && panels.every(panel => {
            const rect = panel.getBoundingClientRect();
            return !rect.height || (rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1);
        });
    })).toBeTruthy();
}
