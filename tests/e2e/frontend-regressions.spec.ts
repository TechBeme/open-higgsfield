import type { Page } from "@playwright/test";
import { test, expect, mockWorkspace } from "./fixtures";
import pt from "../../src/messages/pt-BR.json";
import type { ProviderConnectionRecord } from "../../src/providers/config-types";

const googleProvider = "google-ai-studio";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4+t8dK2IYWhIAylSGwYMD4fAAAAAASUVORK5CYII=", "base64");

test("a confirmed connection save closes the dialog even if refreshing fails", async ({ page }) => {
    const state = await mockWorkspace(page, { connected: false });
    let saves = 0;
    const label = "Synthetic saved connection";
    await page.route("**/api/providers", async route => {
        if (route.request().method() !== "POST") return route.fallback();
        saves++;
        const body = route.request().postDataJSON();
        expect(body).toMatchObject({ providerId: googleProvider, label, secret: "synthetic-e2e-key-only" });
        const connection: ProviderConnectionRecord = {
            id: "synthetic-saved", providerId: googleProvider, label, enabled: true,
            priority: 100, metadata: {}, secretConfigured: true, lastHealth: "unknown",
            createdAt: "2026-11-02T00:00:00Z", updatedAt: "2026-11-02T00:00:00Z",
        };
        state.connections.push(connection);
        state.connectedProviderIds = [googleProvider];
        state.providersError = true;
        await route.fulfill({ status: 201, json: { connection } });
    });
    await page.goto(`/pt-BR/settings?provider=${googleProvider}`);
    await page.getByRole("button", { name: pt.providers.addConnection, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(pt.providers.name, { exact: true }).fill(label);
    await dialog.getByLabel(pt.providers.apiKey, { exact: true }).fill("synthetic-e2e-key-only");
    await dialog.getByRole("button", { name: pt.providers.save, exact: true }).click();
    await expect(dialog).toBeHidden();
    const providerError = page.getByRole("main").getByRole("alert");
    const retry = providerError.getByRole("button", { name: pt.providers.retry, exact: true });
    await expect(retry).toBeVisible();
    state.providersError = false;
    await retry.click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(providerError).toBeHidden();
    expect(saves).toBe(1);
});

test("a confirmed custom model save is not repeated after a catalog refresh failure", async ({ page }) => {
    const state = await mockWorkspace(page);
    const template = state.catalog.images.find(model => model.provider === googleProvider)!;
    const label = "Synthetic custom image model";
    const upstream = "synthetic-custom-image";
    let saves = 0;
    await page.route("**/api/catalog", async route => {
        if (route.request().method() !== "POST") return route.fallback();
        saves++;
        const body = route.request().postDataJSON();
        expect(body).toMatchObject({ mediaType: "image", enabled: false, capabilities: {
            id: `${googleProvider}__${upstream}`, label, provider: googleProvider, provider_model_id: upstream,
        } });
        const model = { ...body.capabilities, catalog_source: "custom", catalog_status: "disabled" };
        state.catalog.images.push(model);
        state.catalogError = true;
        await route.fulfill({ status: 201, json: { model } });
    });
    await page.goto(`/pt-BR/settings?provider=${googleProvider}`);
    await page.getByRole("button", { name: pt.providers.addModel, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: pt.providers.template, exact: true }).selectOption(template.id);
    await dialog.getByLabel(pt.providers.modelName, { exact: true }).fill(label);
    await dialog.getByLabel(pt.providers.upstreamId, { exact: true }).fill(upstream);
    await dialog.getByRole("button", { name: pt.providers.saveModel, exact: true }).click();
    await expect(dialog).toBeHidden();
    const providerError = page.getByRole("main").getByRole("alert");
    const retry = providerError.getByRole("button", { name: pt.providers.retry, exact: true });
    await expect(retry).toBeVisible();
    state.catalogError = false;
    await retry.click();
    await expect(providerError).toBeHidden();
    await page.getByRole("searchbox", { name: pt.providers.searchModels }).fill(label);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    expect(saves).toBe(1);
});

test("catalog retry can fail again and recover without an unhandled rejection", async ({ page }) => {
    const state = await mockWorkspace(page);
    state.modelsError = true;
    await page.goto("/pt-BR");
    const prompt = page.getByRole("textbox", { name: pt.commandBar.promptLabel });
    const retry = page.getByRole("button", { name: pt.commandBar.retryModels, exact: true });
    await expect(prompt).toBeDisabled();
    await expect(retry).toBeVisible();
    const initialRequests = state.requests.filter(request => request.path === "/api/image-models").length;
    await retry.click();
    await expect.poll(() => state.requests.filter(request => request.path === "/api/image-models").length).toBeGreaterThan(initialRequests);
    await expect(prompt).toBeDisabled();
    await expect(retry).toBeVisible();
    state.modelsError = false;
    await retry.click();
    await expect(prompt).toBeEnabled();
    await expect(retry).toBeHidden();
});

for (const scenario of [
    { mediaType: "image", source: "vercel-ai-gateway__openai__gpt-image-2", target: "toapis__qwen-image-3.0-pro", field: "slot_reference_images" },
    { mediaType: "video", source: "magnific__video__seedance_2_5_pro_480p", target: "toapis__gemini-omni-1.1-flash-preview-vip", field: "file_reference_images" },
] as const) {
    test(`${scenario.mediaType} model changes retain only the destination attachment limit`, async ({ page }) => {
        await mockWorkspace(page);
        const submissions = await interceptSubmission(page, scenario.mediaType);
        await page.goto("/pt-BR");
        if (scenario.mediaType === "video") await page.getByRole("button", { name: pt.common.video, exact: true }).click();
        await chooseModel(page, scenario.mediaType, scenario.source);
        const filenames = Array.from({ length: 5 }, (_, index) => `synthetic-reference-${index + 1}.png`);
        await page.getByRole("button", { name: pt.commandBar.attach, exact: true }).click();
        const references = page.getByRole("region", { name: pt.commandBar.slots.reference_images, exact: true });
        await references.getByLabel(`${pt.commandBar.upload} - ${pt.commandBar.slots.reference_images}`, { exact: true }).setInputFiles(
            filenames.map(name => ({ name, mimeType: "image/png", buffer: png })),
        );
        await expect(references.getByRole("button", { name: /^Remover / })).toHaveCount(5);
        await page.keyboard.press("Escape");
        await chooseModel(page, scenario.mediaType, scenario.target);
        await page.getByRole("button", { name: pt.commandBar.attach, exact: true }).click();
        await expect(references.getByRole("button", { name: /^Remover / })).toHaveCount(3);
        for (const name of filenames.slice(0, 3)) await expect(references.getByText(name, { exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
        await submitPrompt(page);
        await expect.poll(() => submissions.length).toBe(1);
        expect(submissions[0].get("model_id")).toBe(scenario.target);
        expect(submissions[0].getAll(scenario.field).map(file => (file as File).name)).toEqual(filenames.slice(0, 3));
    });
}

test("image models accept video drops in video slots without rendering an image thumbnail", async ({ page }) => {
    await mockWorkspace(page);
    const submissions = await interceptSubmission(page, "image");
    await page.goto("/pt-BR");
    await chooseModel(page, "image", "google-ai-studio__gemini-3.1-flash-image");
    const filename = "synthetic-reference-video.mp4";
    // These bytes exercise upload routing only; no decoder or provider receives the fixture.
    const dataTransfer = await page.evaluateHandle(name => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["synthetic video upload fixture"], name, { type: "video/mp4" }));
        return transfer;
    }, filename);
    try {
        await page.locator("body").dispatchEvent("dragenter", { dataTransfer });
        const dropTarget = page.getByText(pt.commandBar.slots.input_video, { exact: true }).locator("..");
        await expect(dropTarget).toBeVisible();
        await dropTarget.dispatchEvent("dragover", { dataTransfer });
        await dropTarget.dispatchEvent("drop", { dataTransfer });
    } finally {
        await dataTransfer.dispose();
    }
    await expect(page.getByRole("button", { name: pt.commandBar.removeAttachment.replace("{name}", filename), exact: true })).toBeVisible();
    await expect(page.locator('img[src^="blob:"]')).toHaveCount(0);
    await page.getByRole("button", { name: pt.commandBar.attach, exact: true }).click();
    const videoReferences = page.getByRole("region", { name: pt.commandBar.slots.input_video, exact: true });
    await expect(videoReferences.getByText(filename, { exact: true })).toBeVisible();
    await expect(videoReferences.locator("img")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await submitPrompt(page);
    await expect.poll(() => submissions.length).toBe(1);
    const video = submissions[0].get("slot_input_video") as File;
    expect(video.name).toBe(filename);
    expect(video.type).toBe("video/mp4");
    expect(submissions[0].getAll("slot_reference_images")).toHaveLength(0);
});

test("seven pending tasks update through shared polling without per-card event streams", async ({ page }) => {
    const state = await mockWorkspace(page);
    const model = state.catalog.images.find(model => model.provider === googleProvider)!;
    state.history = Array.from({ length: 7 }, (_, index) => ({
        task_id: `synthetic-task-${index}`, media_type: "image", model_id: model.id,
        status: "IN_PROGRESS", _done: false, created_at: "2026-11-02T00:00:00Z", prompt: `Synthetic task ${index}`,
    }));
    await page.route("**/e2e-result.svg?*", route => route.fulfill({
        contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#d5ff47"/></svg>',
    }));
    await page.goto("/pt-BR");
    await expect(page.getByText(pt.tasks.waiting, { exact: true })).toHaveCount(7);
    const initialPolls = state.requests.filter(request => request.path.startsWith("/api/image-tasks?")).length;
    expect(state.requests.filter(request => request.path.startsWith("/api/events/"))).toHaveLength(0);
    state.history = state.history.map((task, index) => ({ ...task, status: "COMPLETED", _done: true, result_urls: [`/e2e-result.svg?result=${index}`] }));
    await expect(page.getByRole("button", { name: new RegExp(`^${pt.tasks.preview} - `) })).toHaveCount(7);
    await expect(page.getByText(pt.tasks.waiting, { exact: true })).toHaveCount(0);
    expect(state.requests.filter(request => request.path.startsWith("/api/image-tasks?")).length).toBeGreaterThan(initialPolls);
    expect(state.requests.filter(request => request.path.startsWith("/api/events/"))).toHaveLength(0);
});

test("a rejected connection write retains the entered data for correction", async ({ page }) => {
    const state = await mockWorkspace(page, { connected: false });
    await page.goto(`/pt-BR/settings?provider=${googleProvider}`);
    await page.getByRole("button", { name: pt.providers.addConnection, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(pt.providers.name, { exact: true }).fill("Synthetic rejected connection");
    await dialog.getByLabel(pt.providers.apiKey, { exact: true }).fill("synthetic-rejected-key");
    await dialog.getByRole("button", { name: pt.providers.save, exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel(pt.providers.name, { exact: true })).toHaveValue("Synthetic rejected connection");
    await expect(dialog.getByLabel(pt.providers.apiKey, { exact: true })).toHaveValue("synthetic-rejected-key");
    await expect(dialog.getByRole("button", { name: pt.providers.save, exact: true })).toBeEnabled();
    expect(state.requests.filter(request => request.method === "POST" && request.path === "/api/providers")).toHaveLength(1);
});

async function interceptSubmission(page: Page, mediaType: "image" | "video") {
    const submissions: FormData[] = [];
    await page.route(mediaType === "image" ? "**/api/generate-image" : "**/api/generate", async route => {
        const request = route.request();
        const contentType = await request.headerValue("content-type");
        const body = new Uint8Array(request.postDataBuffer()!);
        submissions.push(await new Response(body, { headers: { "content-type": contentType! } }).formData());
        await route.fulfill({ status: 400, json: { error: "ERR_INVALID_FIELD_VALUES", accepted: false, recovery_required: false } });
    });
    return submissions;
}

async function submitPrompt(page: Page) {
    await page.getByRole("textbox", { name: pt.commandBar.promptLabel }).fill("Synthetic reference regression test");
    await page.getByRole("button", { name: new RegExp(`^${pt.common.generate}`) }).click();
}

async function chooseModel(page: Page, mediaType: "image" | "video", id: string) {
    await page.getByRole("button", { name: mediaType === "image" ? pt.commandBar.chooseImageModel : pt.commandBar.chooseVideoModel }).click();
    await page.getByRole("searchbox", { name: pt.commandBar.searchModels }).fill(id);
    await page.locator(`[data-model-id="${id}"]`).click();
    await expect(page.getByRole("searchbox", { name: pt.commandBar.searchModels })).toBeHidden();
}
