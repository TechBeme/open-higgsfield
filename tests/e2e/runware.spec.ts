import AxeBuilder from "@axe-core/playwright";
import { test, expect, mockWorkspace, expectWithinViewport } from "./fixtures";
import en from "../../src/messages/en.json";
import pt from "../../src/messages/pt-BR.json";
import es from "../../src/messages/es.json";

for (const locale of ["en", "pt-BR", "es"] as const) {
    const m = { en, "pt-BR": pt, es }[locale];
    test(`${locale}: Runware provider, official logo, discovery, image and video controls`, async ({ page }, testInfo) => {
        const state = await mockWorkspace(page);
        state.connectedProviderIds = ["runware"];
        state.connections = [{ id: "conn_runware_demo", providerId: "runware", label: "Runware", enabled: true, priority: 100,
            metadata: {}, secretConfigured: true, lastHealth: "healthy", createdAt: "2026-11-03T00:00:00.000Z", updatedAt: "2026-11-03T00:00:00.000Z" }];
        await page.goto(`/${locale}/settings?provider=runware`);
        await expect(page.locator("h1").filter({ hasText: /^Runware$/ })).toBeVisible();
        const mark = page.locator('img[src="/providers/runware.svg"]');
        await expect(mark).toBeVisible();
        expect(await mark.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect(page.getByRole("button", { name: m.providers.sync, exact: true })).toBeEnabled();
        await expect(page.getByRole("button", { name: m.providers.addConnection, exact: true })).toBeVisible();
        await expect(page.getByText("openai:gpt-image@2", { exact: true })).toBeVisible();
        await expectWithinViewport(page);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`runware-provider-${locale}.png`), fullPage: true, animations: "disabled" });

        await page.route("**/api/providers/conn_runware_demo/test", async route => {
            expect(route.request().method()).toBe("POST");
            await route.fulfill({ json: { status: "healthy" } });
        });
        await page.getByRole("button", { name: m.providers.test, exact: true }).click();
        await expect(page.getByRole("status").filter({ hasText: m.providers.testSuccess })).toBeVisible();
        await page.route("**/api/catalog/discover", async route => {
            expect(route.request().postDataJSON()).toEqual({ providerId: "runware", connectionId: "conn_runware_demo" });
            state.catalog.discovered = [{ id: "discovered_runware_demo", providerId: "runware", providerModelId: "example:new-model@1",
                displayName: "Runware discovery candidate", status: "unverified" }];
            await route.fulfill({ json: { status: "unverified", discovered: state.catalog.discovered } });
        });
        await page.getByRole("button", { name: m.providers.sync, exact: true }).click();
        await page.locator("summary").filter({ hasText: m.providers.discovered }).click();
        await expect(page.getByText("example:new-model@1", { exact: true })).toBeVisible();

        await page.goto(`/${locale}`);
        await page.getByRole("button", { name: m.commandBar.chooseImageModel, exact: true }).click();
        await expect(page.getByText("Runware discovery candidate", { exact: true })).toHaveCount(0);
        await page.locator('[data-model-id="runware__google-nano-banana-2-1"]').click();
        await expect(page.getByRole("textbox", { name: m.commandBar.promptLabel })).toBeEnabled();
        await page.getByRole("button", { name: m.commandBar.controls, exact: true }).click();
        const label = m.commandBar.fields.output_size;
        const size = page.getByLabel(label, { exact: true });
        await expect(size).toBeVisible(); await size.selectOption("1024x1024");
        // Axe treats an opening popup with opacity 0 as hidden, while Playwright's visibility check does not.
        const imageSettings = page.getByRole("dialog", { name: m.commandBar.controls, exact: true });
        await expect(imageSettings).toHaveCSS("opacity", "1");
        await expectWithinViewport(page);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`runware-image-controls-${locale}.png`), animations: "disabled" });
        await page.keyboard.press("Escape");
        await expect(imageSettings).toHaveCount(0);

        await page.getByRole("button", { name: m.common.video, exact: true }).click();
        await page.getByRole("button", { name: m.commandBar.chooseVideoModel, exact: true }).click();
        await page.locator('[data-model-id="runware__google-veo-3-1"]').click();
        await page.getByRole("button", { name: m.commandBar.controls, exact: true }).click();
        await expect(page.getByRole("switch", { name: m.commandBar.fields.provider_settings_google_generate_audio, exact: true })).toBeVisible();
        const videoSettings = page.getByRole("dialog", { name: m.commandBar.controls, exact: true });
        await expect(videoSettings).toHaveCSS("opacity", "1");
        await size.focus();
        await page.keyboard.press("Tab");
        await expect(videoSettings.locator("select").nth(1)).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(size).toBeFocused();
        await expectWithinViewport(page);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`runware-video-controls-${locale}.png`), animations: "disabled" });
        expect(state.requests.filter(req => req.path.startsWith("/api/generate"))).toEqual([]);
    });
}
