import { test, expect } from "./fixtures";
import en from "../../src/messages/en.json";

test("real isolated API: save, pause and remove the last connection updates Studio without F5", async ({ page }, testInfo) => {
    const label = `Synthetic E2E ${testInfo.project.name}`;
    const secret = "synthetic-provider-key-not-valid-with-any-service";
    let id: string | undefined;
    try {
        await page.goto("/en/settings?provider=google-ai-studio");
        await page.getByRole("button", { name: en.providers.addConnection, exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel(en.providers.name, { exact: true }).fill(label);
        await dialog.getByLabel(en.providers.apiKey, { exact: true }).fill(secret);
        await dialog.getByRole("button", { name: en.providers.save, exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
        const response = await page.request.get("/api/providers");
        const json = await response.json();
        expect(JSON.stringify(json)).not.toContain(secret);
        id = json.connections.find((connection: {label: string}) => connection.label === label)?.id;
        expect(id).toBeTruthy();

        await page.getByRole("link", { name: en.workspace.studio, exact: true }).click();
        await expect(page.getByRole("textbox", { name: en.commandBar.promptLabel })).toBeEnabled();
        await page.getByRole("button", { name: en.commandBar.chooseImageModel }).click();
        await expect(page.locator("[data-model-id]").first()).toBeVisible();
        const modelProviders = await page.locator("[data-model-id]").evaluateAll(elements => elements.map(element => element.getAttribute("data-model-id")));
        expect(modelProviders.every(model => model?.startsWith("google-ai-studio__"))).toBeTruthy();
        await page.keyboard.press("Escape");

        await page.getByRole("link", { name: en.workspace.providers, exact: true }).click();
        await page.locator('a[href*="provider=google-ai-studio"]').click();
        const enabledLabel = en.providers.enableName.replace("{name}", label);
        await page.getByRole("switch", { name: enabledLabel }).click();
        await expect(page.getByRole("switch", { name: enabledLabel })).not.toBeChecked();
        await page.getByRole("link", { name: en.workspace.studio, exact: true }).click();
        await expect(page.getByRole("textbox", { name: en.commandBar.promptLabel })).toBeDisabled();
        await page.getByRole("button", { name: en.commandBar.chooseImageModel }).click();
        await expect(page.locator("[data-model-id]")).toHaveCount(0);
        await expect(page.getByText(en.commandBar.noConnectedModels)).toBeVisible();
        await page.keyboard.press("Escape");

        await page.getByRole("link", { name: en.workspace.providers, exact: true }).click();
        await page.locator('a[href*="provider=google-ai-studio"]').click();
        await page.getByRole("button", { name: en.providers.deleteName.replace("{name}", label) }).click();
        const confirmation = page.getByRole("alertdialog");
        const [deletion] = await Promise.all([
            page.waitForResponse(response => response.url().endsWith(`/api/providers/${id}`) && response.request().method() === "DELETE"),
            confirmation.getByRole("button", { name: en.providers.deleteConfirm, exact: true }).click(),
        ]);
        expect(deletion.ok()).toBeTruthy();
        expect(await deletion.json()).toMatchObject({ deleted: true });
        await expect(confirmation).toBeHidden();
        await expect(page.getByRole("heading", { name: label, exact: true })).toBeHidden();
        expect((await (await page.request.get("/api/providers")).json()).connections).toEqual([]);
    } finally {
        const saved = (await (await page.request.get("/api/providers")).json()).connections;
        const cleanupId = id ?? saved.find((connection: {label: string}) => connection.label === label)?.id;
        if (cleanupId) {
            const origin = new URL(page.url()).origin;
            await page.request.delete(`/api/providers/${cleanupId}`, { headers: { origin } });
        }
    }
});
