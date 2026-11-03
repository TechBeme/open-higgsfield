import AxeBuilder from "@axe-core/playwright";
import { test, expect, mockWorkspace, expectWithinViewport } from "./fixtures";
import en from "../../src/messages/en.json";
import pt from "../../src/messages/pt-BR.json";
import es from "../../src/messages/es.json";

const messages = { en, "pt-BR": pt, es };

for (const [locale, m] of Object.entries(messages)) {
    test(`${locale}: hydration, empty Studio, navigation and accessibility`, async ({ page }, testInfo) => {
        await mockWorkspace(page, { connected: false });
        const response = await page.goto(`/${locale}`);
        const html = await response!.text();
        expect(html.indexOf('name="darkreader-lock"')).toBeGreaterThan(0);
        expect(html.indexOf('name="darkreader-lock"')).toBeLessThan(html.indexOf("<body"));
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await expect(page).toHaveTitle(m.metadata.title);
        await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "dark");
        await expect(page.getByRole("textbox", { name: m.commandBar.promptLabel })).toBeDisabled();
        await expect(page.getByRole("button", { name: new RegExp(`^${m.common.generate}`) })).toBeDisabled();
        await expectWithinViewport(page);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath("studio.png"), fullPage: true });

        await page.getByRole("link", { name: m.workspace.providers, exact: true }).click();
        await expect(page.getByRole("heading", { name: m.providers.title })).toBeVisible();
        await expect(page.locator(".provider-card")).toHaveCount(6);
        for (const mark of await page.locator('.provider-card img').all()) {
            await mark.scrollIntoViewIfNeeded();
            await mark.evaluate(image => (image as HTMLImageElement).decode());
            await expect(mark).toHaveCSS("object-fit", "contain");
        }
        await page.reload();
        await expect(page.locator(".provider-card")).toHaveCount(6);
        await expectWithinViewport(page);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath("providers.png"), fullPage: true });
    });

    test(`${locale}: every provider dialog has valid labels, validation and focus return`, async ({ page }) => {
        const state = await mockWorkspace(page, { connected: false });
        for (const provider of state.providers) {
            await page.goto(`/${locale}/settings?provider=${provider.id}`);
            await expect(page.getByRole("heading", { name: provider.label, exact: true })).toBeVisible();
            const opener = page.getByRole("button", { name: m.providers.addConnection, exact: true });
            await opener.click();
            const dialog = page.getByRole("dialog");
            const name = dialog.getByLabel(m.providers.name, { exact: true });
            await expect(name).toBeFocused();
            await dialog.getByRole("button", { name: m.providers.save, exact: true }).click();
            await expect(name).toBeFocused();
            await expect.poll(() => name.evaluate(element => (element as HTMLInputElement).validity.valueMissing)).toBe(true);
            await name.fill("Synthetic local connection");
            const secret = dialog.getByLabel(provider.secretKind === "google-service-account" ? m.providers.serviceAccount : m.providers.apiKey, { exact: true });
            await expect(secret).toBeVisible();
            if (provider.secretKind === "google-service-account") {
                await secret.fill("not valid JSON");
                await dialog.getByRole("button", { name: m.providers.save, exact: true }).click();
                await expect(dialog.getByRole("alert")).toHaveText(m.providers.invalidCredentials);
            } else {
                await secret.fill("synthetic-key-only");
                await expect(secret).toHaveAttribute("type", "password");
                await dialog.getByRole("button", { name: m.providers.showKey, exact: true }).click();
                await expect(secret).toHaveAttribute("type", "text");
            }
            await expectWithinViewport(page);
            expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
            await dialog.getByRole("button", { name: m.common.close, exact: true }).click();
            await expect(dialog).toBeHidden();
            await expect(opener).toBeFocused();
        }
        expect(state.requests.filter(request => request.method !== "GET")).toEqual([]);
    });

    test(`${locale}: manifests, missing pages and model search stay localized`, async ({ page }) => {
        const state = await mockWorkspace(page);
        const manifest = await page.request.get(`/${locale}/manifest.webmanifest`);
        expect(manifest.ok()).toBeTruthy();
        expect(await manifest.json()).toMatchObject({ lang: locale, start_url: `/${locale}`, name: m.metadata.appName });
        const missing = await page.goto(`/${locale}/missing-regression-page`);
        expect(missing!.status()).toBe(404);
        await expect(page.getByRole("heading", { name: m.errorPages.notFoundTitle })).toBeVisible();
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
        await page.getByRole("link", { name: m.errorPages.home, exact: true }).click();
        for (const mediaType of ["image", "video"] as const) {
            if (mediaType === "video") await page.getByRole("button", { name: m.common.video, exact: true }).click();
            await page.getByRole("button", { name: mediaType === "image" ? m.commandBar.chooseImageModel : m.commandBar.chooseVideoModel }).click();
            const model = (mediaType === "image" ? state.catalog.images : state.catalog.videos).find(model => model.provider === "google-ai-studio")!;
            await page.getByRole("searchbox", { name: m.commandBar.searchModels }).fill(model.id);
            await expect(page.locator("[data-model-id]")).toHaveCount(1);
            await expect(page.locator("[data-model-id]")).toHaveAttribute("data-model-id", model.id);
            await expectWithinViewport(page);
            await page.keyboard.press("Escape");
        }
    });
}

test("language switching preserves the provider, query, cookie and reload", async ({ page, context }) => {
    await mockWorkspace(page);
    await page.goto("/en/settings?provider=google-vertex&qa=preserved");
    let current: keyof typeof messages = "en";
    for (const next of ["es", "pt-BR", "en"] as const) {
        await page.getByRole("button", { name: messages[current].workspace.language, exact: true }).click();
        await page.getByRole("menuitem", { name: messages[current].languages[next], exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/${next}/settings\\?provider=google-vertex&qa=preserved$`));
        await expect(page.getByRole("button", { name: messages[next].workspace.language, exact: true })).toBeVisible();
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("lang", next);
        await expect(page.getByRole("heading", { name: "Google Vertex AI", exact: true })).toBeVisible();
        expect((await context.cookies()).find(cookie => cookie.name === "NEXT_LOCALE")?.value).toBe(next);
        current = next;
    }
});

test("an uncertain generation response warns about that request without blocking new work", async ({ page }) => {
    await mockWorkspace(page);
    let submissions = 0;
    await page.route("**/api/generate-image", route => {
        submissions++;
        return route.fulfill({ status: 200, contentType: "text/html", body: "Synthetic upstream connection failure" });
    });
    await page.goto("/en");
    await page.getByRole("textbox", { name: en.commandBar.promptLabel }).fill("Synthetic image test");
    await page.getByRole("button", { name: new RegExp(`^${en.common.generate}`) }).click();
    await expect(page.getByText(en.errors.ERR_SUBMISSION_OUTCOME_UNKNOWN)).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`^${en.common.generate}`) })).toBeEnabled();
    await page.getByRole("textbox", { name: en.commandBar.promptLabel }).press("Enter");
    await expect.poll(() => submissions).toBe(2);
});

test("history pagination failure preserves results and retry deduplicates pages", async ({ page }) => {
    const state = await mockWorkspace(page);
    const model = state.catalog.images[0];
    const task = (id: string) => ({ task_id: id, media_type: "image", model_id: model.id, status: "FAILED", _done: true, prompt: id, created_at: "2026-11-02T00:00:00Z", error_message: "ERR_PROVIDER_UNAVAILABLE" });
    let failSecondPage = true;
    await page.route("**/api/image-tasks?*", route => {
        const second = new URL(route.request().url()).searchParams.has("cursor");
        if (second && failSecondPage) return route.fulfill({ status: 503, json: { error: "ERR_TASK_STORAGE_UNAVAILABLE" } });
        return route.fulfill({ json: { tasks: second ? [task("history-b"), task("history-c")] : [task("history-a"), task("history-b")], nextCursor: second ? null : "next_page" } });
    });
    await page.goto("/en");
    await expect(page.locator("article")).toHaveCount(2);
    await page.getByRole("button", { name: en.tasks.loadMore, exact: true }).click();
    await expect(page.getByText(en.tasks.historyError)).toBeVisible();
    await expect(page.locator("article")).toHaveCount(2);
    failSecondPage = false;
    await page.getByRole("button", { name: en.tasks.retryHistory, exact: true }).click();
    await expect(page.locator("article")).toHaveCount(3);
    await expect(page.getByText(en.tasks.historyError)).toBeHidden();
});
