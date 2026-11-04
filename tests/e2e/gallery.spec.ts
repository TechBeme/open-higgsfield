import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, mockWorkspace, expectWithinViewport } from "./fixtures";
import type { GalleryReference } from "../../src/lib/gallery";
import en from "../../src/messages/en.json";
import pt from "../../src/messages/pt-BR.json";
import es from "../../src/messages/es.json";

async function gallery(page: Page) {
    const state = await mockWorkspace(page);
    const modelId = "toapis__qwen-image-3.0-pro";
    state.history = [
        { task_id: "gallery-a", media_type: "image", model_id: modelId, status: "COMPLETED", prompt: "A quiet coast at sunrise", created_at: "2026-01-03T00:00:00Z", has_download: true, result_count: 2, _done: true },
        { task_id: "gallery-b", media_type: "image", model_id: modelId, status: "COMPLETED", prompt: "A modern house in the forest", created_at: "2026-01-02T00:00:00Z", has_download: true, result_count: 1, _done: true },
        { task_id: "gallery-error", media_type: "image", model_id: modelId, status: "ERROR", prompt: "A failed generation", created_at: "2026-01-01T00:00:00Z", error_message: "ERR_RUNWARE_TASK_FAILED", _done: true },
    ];
    await page.route("**/api/download/**", route => {
        const url = new URL(route.request().url());
        const blue = url.pathname.includes("gallery-b");
        const second = url.searchParams.get("index") === "1";
        return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="640"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${blue ? "#183b32" : second ? "#483960" : "#a45c41"}"/><stop offset="1" stop-color="${blue ? "#699b78" : second ? "#deb1b2" : "#edd1ac"}"/></linearGradient></defs><rect width="800" height="640" fill="url(#g)"/><circle cx="550" cy="170" r="75" fill="#fff" opacity=".25"/><path d="M0 510L230 260 470 570 660 370 800 560V640H0Z" fill="#081a1a" opacity=".45"/></svg>` });
    });
    const mutations: { action: string; mediaType: string; items: GalleryReference[] }[] = [];
    const failures = { delete: false, reorder: false, refresh: false };
    await page.route("**/api/gallery", async route => {
        const body = route.request().postDataJSON(); mutations.push(body);
        if (failures[body.action as "delete" | "reorder"]) return route.fulfill({ status: 403, json: { error: "ERR_ORIGIN_FORBIDDEN" } });
        if (body.action === "delete") {
            state.history = state.history.flatMap(task => {
                const items: GalleryReference[] = body.items.filter((item: GalleryReference) => item.taskId === task.task_id);
                if (items.some(item => item.index === null)) return [];
                const removed = [...new Set([...(task.gallery?.removed ?? []), ...items.map(item => item.index!)])];
                return removed.length >= (task.result_count ?? 1) ? [] : [{ ...task, gallery: { order: task.gallery?.order ?? {}, removed } }];
            });
        } else {
            const base = -Date.now();
            state.history = state.history.map(task => {
                const order = { ...task.gallery?.order };
                body.items.forEach((item: GalleryReference, position: number) => { if (item.taskId === task.task_id) order[String(item.index ?? "task")] = base + position / 1000; });
                return { ...task, gallery: { removed: task.gallery?.removed ?? [], order } };
            });
        }
        if (failures.refresh) state.historyError = true;
        await route.fulfill({ json: { ok: true, items: body.items } });
    });
    return { state, mutations, failures };
}
const cards = (page: Page) => page.locator("[data-gallery-key]");
const card = (page: Page, key: string) => page.locator(`[data-gallery-key="${key}"]`);
async function keys(page: Page) { return cards(page).evaluateAll(nodes => nodes.map(node => node.getAttribute("data-gallery-key"))); }
/** Desktop shows quick actions on hover; touchscreens keep them in each tile's "more" menu. */
const touch = () => test.info().project.name === "mobile-chromium";
async function tileAction(page: Page, key: string, name: string) {
    if (!touch()) { await card(page, key).hover(); return card(page, key).getByRole("button", { name, exact: true }).click(); }
    await card(page, key).getByRole("button", { name: en.tasks.moreActions, exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
}
async function menuAction(page: Page, key: string, name: string) {
    await card(page, key).hover();
    await card(page, key).getByRole("button", { name: en.tasks.moreActions, exact: true }).click();
    await page.getByRole("menuitem", { name, exact: true }).click();
}
/** Filters, sorting and density live in one header popover to keep the gallery chrome to a single row. */
async function viewOptions(page: Page, m: typeof en = en) { await page.getByRole("button", { name: m.tasks.viewOptions, exact: true }).click(); }

for (const [locale, m] of Object.entries({ en, "pt-BR": pt, es })) {
    test(`${locale}: gallery renders selection, filters, responsive layouts and accessible actions`, async ({ page }, info) => {
        await gallery(page); await page.goto(`/${locale}`);
        await expect(cards(page)).toHaveCount(4);
        const header = await page.locator("[data-workspace-header]").boundingBox();
        expect(header!.height, "Navigation and gallery tools share one compact row").toBeLessThanOrEqual(56);
        await card(page, "gallery-a:0").hover();
        await expect(card(page, "gallery-a:0").getByRole("button", { name: touch() ? m.tasks.moreActions : m.tasks.delete, exact: true })).toBeVisible();
        await card(page, "gallery-a:0").getByRole("checkbox").click();
        await card(page, "gallery-b:0").getByRole("checkbox").click();
        await expect(page.getByRole("button", { name: m.tasks.deleteSelected })).toBeEnabled();
        await expectWithinViewport(page);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        await page.screenshot({ path: info.outputPath(`gallery-${locale}-selected.png`), fullPage: true });
        await page.getByRole("button", { name: m.tasks.cancelSelection }).click();
        // The search field is always open on wider screens and folds into an icon on phones.
        if (touch()) await page.getByRole("button", { name: m.tasks.searchGallery, exact: true }).click();
        else await expect(page.getByRole("button", { name: m.tasks.searchGallery, exact: true })).toHaveCount(0);
        await page.getByRole("searchbox", { name: m.tasks.searchGallery }).fill("forest");
        await expect(cards(page)).toHaveCount(1);
        await page.getByRole("searchbox", { name: m.tasks.searchGallery }).fill("");
        await viewOptions(page, m);
        await page.getByRole("combobox", { name: m.tasks.filterGallery }).selectOption("failed");
        await expect(cards(page)).toHaveCount(1);
        await page.getByRole("combobox", { name: m.tasks.filterGallery }).selectOption("all");
        // The size slider sits in the header on wider screens and inside view options on phones.
        const before = (await card(page, "gallery-b:0").boundingBox())!.height;
        await page.getByRole("slider", { name: m.tasks.densityLabel }).focus();
        await page.keyboard.press("Home");
        await expect.poll(async () => (await card(page, "gallery-b:0").boundingBox())!.height).toBeLessThan(before);
        await expectWithinViewport(page);
        await page.screenshot({ path: info.outputPath(`gallery-${locale}-compact.png`), fullPage: true });
        await page.getByRole("combobox", { name: m.tasks.sortGallery }).selectOption("oldest");
        await expect.poll(async () => (await keys(page))[0]).toBe("gallery-error:task");
        await page.getByRole("combobox", { name: m.tasks.sortGallery }).selectOption("newest");
        await expect.poll(async () => (await keys(page))[0]).toBe("gallery-a:0");
        if (info.project.name === "mobile-chromium") {
            // Justified rows fit at least two square previews side by side on a phone instead of one oversized tile.
            const widths = await cards(page).evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().width));
            expect(Math.max(...widths)).toBeLessThan(page.viewportSize()!.width * 0.75);
        }
    });
}

for (const [locale, m] of Object.entries({ en, "pt-BR": pt, es })) {
    test(`${locale}: a confirmed Runware content rejection shows the safety message instead of an unknown outcome`, async ({ page }) => {
        const { state } = await gallery(page);
        state.history = [{ task_id: "moderation-blocked", media_type: "image", model_id: "runware__openai-gpt-image-2-5-flare",
            status: "FAILED", lifecycle_phase: "terminal", recovery_required: false, created_at: "2026-01-03T00:00:00Z",
            error_message: "ERR_RUNWARE_CONTENT_BLOCKED", _done: true }];
        await page.goto(`/${locale}`);
        const item = card(page, "moderation-blocked:task");
        await expect(item).toContainText(m.errors.ERR_RUNWARE_CONTENT_BLOCKED);
        await expect(item).not.toContainText(m.tasks.recoveryRequired);
        await expect(item).not.toContainText("ERR_RUNWARE_HTTP_400");
        await expect(item).not.toContainText("safety_violations");
    });
}

test("deleting one image keeps its sibling index and updates the gallery immediately", async ({ page }) => {
    const { mutations } = await gallery(page); await page.goto("/en");
    await tileAction(page, "gallery-a:0", en.tasks.delete);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(card(page, "gallery-a:0")).toHaveCount(0);
    await expect(card(page, "gallery-a:1")).toBeVisible();
    await expect(card(page, "gallery-a:1").locator("img")).toHaveAttribute("src", "/api/download/gallery-a?index=1&inline=1");
    expect(mutations[0].items).toEqual([{ taskId: "gallery-a", index: 0 }]);
    await page.reload(); await expect(cards(page)).toHaveCount(3);
});

test("select visible deletes multiple outputs and failed tasks in one confirmed batch", async ({ page }) => {
    const { mutations } = await gallery(page); await page.goto("/en");
    await card(page, "gallery-b:0").getByRole("checkbox").click();
    await page.getByRole("button", { name: en.tasks.selectVisible, exact: true }).click();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
    await page.getByRole("button", { name: en.tasks.deleteSelected }).click();
    await expect(page.getByRole("alertdialog")).toContainText("4");
    await page.getByRole("alertdialog").getByRole("button", { name: en.tasks.cancel, exact: true }).click();
    expect(mutations).toHaveLength(0);
    await page.getByRole("button", { name: en.tasks.deleteSelected }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: en.tasks.deleteConfirm, exact: true }).click();
    await expect(cards(page)).toHaveCount(0);
    expect(mutations).toHaveLength(1);
    expect(mutations[0].items).toHaveLength(4);
    expect(mutations[0].items).toContainEqual({ taskId: "gallery-error", index: null });
});

test("failed deletion preserves selection and retry removes only the chosen image", async ({ page }) => {
    const { failures, mutations } = await gallery(page); failures.delete = true;
    await page.goto("/en");
    await card(page, "gallery-a:1").getByRole("checkbox").click();
    await page.getByRole("button", { name: en.tasks.deleteSelected }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: en.tasks.deleteConfirm, exact: true }).click();
    await expect(page.getByRole("alertdialog").getByRole("alert")).toContainText(en.errors.ERR_ORIGIN_FORBIDDEN);
    await expect(cards(page)).toHaveCount(4);
    failures.delete = false;
    await page.getByRole("alertdialog").getByRole("button", { name: en.tasks.deleteConfirm, exact: true }).click();
    await expect(cards(page)).toHaveCount(3);
    expect(mutations[1].items).toEqual([{ taskId: "gallery-a", index: 1 }]);
});

test("dragging an image onto another reorders and saves at once without attaching it to the prompt", async ({ page }, info) => {
    test.skip(info.project.name === "mobile-chromium", "Touchscreens reorder from each tile's menu, covered by the next test.");
    const { mutations } = await gallery(page); await page.goto("/en");
    await card(page, "gallery-b:0").dragTo(card(page, "gallery-a:0"), { steps: 12 });
    await expect.poll(async () => (await keys(page))[0]).toBe("gallery-b:0");
    await expect.poll(() => mutations.filter(item => item.action === "reorder").length).toBe(1);
    await expect(page.locator("[data-studio-composer]").getByRole("textbox")).toBeVisible();
    await expect(page.locator('[data-studio-composer] img[src^="/api/download/"]')).toHaveCount(0);
    await page.reload();
    await expect.poll(async () => (await keys(page))[0]).toBe("gallery-b:0");
    await page.screenshot({ path: info.outputPath("gallery-persisted-order.png"), fullPage: true });
});

test("the tile menu moves images for keyboard and touch, and a failed save restores the order", async ({ page }) => {
    const { failures, mutations } = await gallery(page); await page.goto("/en");
    await expect(cards(page)).toHaveCount(4);
    const original = await keys(page);
    failures.reorder = true;
    await menuAction(page, "gallery-a:1", en.tasks.moveBefore);
    await expect(page.getByRole("region", { name: en.tasks.feedTitle, exact: true }).getByRole("alert")).toContainText(en.errors.ERR_ORIGIN_FORBIDDEN);
    await expect.poll(async () => keys(page)).toEqual(original);
    failures.reorder = false;
    await menuAction(page, "gallery-a:1", en.tasks.moveBefore);
    await expect.poll(async () => (await keys(page))[0]).toBe("gallery-a:1");
    await expect(page.getByRole("region", { name: en.tasks.feedTitle, exact: true }).getByRole("alert")).toHaveCount(0);
    expect(mutations.filter(item => item.action === "reorder")).toHaveLength(2);
    await page.reload();
    await expect.poll(async () => (await keys(page))[0]).toBe("gallery-a:1");
    await viewOptions(page);
    await page.getByRole("combobox", { name: en.tasks.sortGallery }).selectOption("newest");
    await page.keyboard.press("Escape");
    await card(page, "gallery-b:0").hover();
    await card(page, "gallery-b:0").getByRole("button", { name: en.tasks.moreActions, exact: true }).click();
    await expect(page.getByRole("menuitem", { name: en.tasks.moveBefore, exact: true }), "Date sorting hides custom positions").toHaveCount(0);
});

test("shift range and keyboard selection operate on visible images without deleting anything", async ({ page }) => {
    const { mutations } = await gallery(page); await page.goto("/en");
    await expect(cards(page)).toHaveCount(4);
    await card(page, "gallery-a:0").getByRole("checkbox").click();
    await card(page, "gallery-b:0").getByRole("checkbox").click({ modifiers: ["Shift"] });
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(3);
    await page.getByRole("region", { name: en.tasks.feedTitle, exact: true }).focus();
    await page.keyboard.press("Control+a");
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
    expect(mutations).toHaveLength(0);
});

test("selection mode toggles image surfaces and failed cards without opening preview", async ({ page }) => {
    const { mutations } = await gallery(page); await page.goto("/en");
    await card(page, "gallery-a:0").getByRole("checkbox").click();
    await card(page, "gallery-b:0").click();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
    await card(page, "gallery-b:0").click();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(1);
    // Failed outputs have no preview button, so the article itself is the selectable surface.
    await card(page, "gallery-error:task").click();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
    await card(page, "gallery-error:task").click();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(1);
    await card(page, "gallery-a:0").click();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mutations).toHaveLength(0);
    // Leaving selection mode restores the normal preview interaction.
    await card(page, "gallery-a:0").click();
    await expect(page.getByRole("dialog")).toBeVisible();
});

test("marquee selection starts in empty gallery space without a prior selection", async ({ page }, info) => {
    const { mutations } = await gallery(page); await page.goto("/en");
    await expect(cards(page)).toHaveCount(4);
    const grid = page.locator("[data-gallery-grid]");
    const bounds = await grid.boundingBox();
    const region = await page.getByRole("region", { name: en.tasks.feedTitle, exact: true }).boundingBox();
    await page.mouse.move(region!.x + region!.width - 2, region!.y + region!.height - 2);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 2, bounds!.y + 2, { steps: 8 });
    await expect(page.locator("[data-gallery-marquee]")).toBeVisible();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
    await page.screenshot({ path: info.outputPath("gallery-marquee-selection.png") });
    await page.mouse.up();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
    await expect(page.locator("[data-gallery-marquee]")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mutations).toHaveLength(0);
});

test("marquee selection can start over an image, shrink to one item and cancel with Escape", async ({ page }) => {
    const { mutations } = await gallery(page); await page.goto("/en");
    await card(page, "gallery-a:0").getByRole("checkbox").click();
    const first = await card(page, "gallery-a:0").boundingBox();
    const grid = await page.locator("[data-gallery-grid]").boundingBox();
    const start = { x: first!.x + first!.width / 2, y: first!.y + first!.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(grid!.x + grid!.width - 2, grid!.y + grid!.height - 2, { steps: 8 });
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
    await page.mouse.move(start.x + 10, start.y + 10, { steps: 5 });
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(1);
    await page.mouse.up();
    await expect(card(page, "gallery-a:0").getByRole("checkbox")).toBeChecked();
    // Escape clears selection and the rectangle even before pointerup.
    await page.mouse.down();
    await page.mouse.move(grid!.x + grid!.width - 2, grid!.y + grid!.height - 2, { steps: 8 });
    await expect(page.locator("[data-gallery-marquee]")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator("[data-gallery-marquee]")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mutations).toHaveLength(0);
});

test("touch selection supports full-card taps and a rectangle without losing pointer capture", async ({ page, context }, info) => {
    test.skip(info.project.name !== "mobile-chromium", "Exercises native touch events on the mobile browser.");
    const { mutations } = await gallery(page); await page.goto("/en");
    await card(page, "gallery-a:0").getByRole("checkbox").tap();
    await card(page, "gallery-b:0").tap();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(2);
    await card(page, "gallery-b:0").tap();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(1);
    const first = await card(page, "gallery-a:0").boundingBox();
    const grid = await page.locator("[data-gallery-grid]").boundingBox();
    const session = await context.newCDPSession(page);
    const start = { x: first!.x + first!.width / 2, y: first!.y + first!.height / 2 };
    const end = { x: grid!.x + grid!.width - 2, y: grid!.y + grid!.height - 2 };
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...start, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, id: 1 }] });
    }
    await expect(page.locator("[data-gallery-marquee]")).toBeVisible();
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
    await expect(page.locator("[data-gallery-marquee]")).toHaveCount(0);
    await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(mutations).toHaveLength(0);
});

test("a saved order remains visible when the follow-up history refresh fails", async ({ page }) => {
    const { state, failures, mutations } = await gallery(page); await page.goto("/en");
    await expect(cards(page)).toHaveCount(4);
    failures.refresh = true;
    await menuAction(page, "gallery-a:1", en.tasks.moveBefore);
    await expect(page.getByText(en.tasks.historyError)).toBeVisible();
    expect((await keys(page))[0]).toBe("gallery-a:1");
    state.historyError = false;
    await page.getByRole("button", { name: en.tasks.retryHistory, exact: true }).click();
    await expect(page.getByText(en.tasks.historyError)).toHaveCount(0);
    expect((await keys(page))[0]).toBe("gallery-a:1");
    expect(mutations).toHaveLength(1);
});

test("hover actions reuse a prompt and send an image to the composer as a reference", async ({ page }) => {
    await gallery(page); await page.goto("/en");
    const tile = card(page, "gallery-b:0");
    await tileAction(page, "gallery-b:0", en.tasks.reusePrompt);
    await expect(page.locator("[data-studio-composer]").getByRole("textbox")).toHaveValue("A modern house in the forest");
    await tile.hover();
    await tile.getByRole("button", { name: en.tasks.moreActions, exact: true }).click();
    await page.getByRole("menuitem", { name: en.tasks.useAsReference, exact: true }).click();
    await expect(page.locator("[data-studio-composer]").getByRole("button", { name: en.commandBar.removeAttachment.replace("{name}", en.commandBar.urlReference) })).toBeVisible();
});

test("the preview size slider resizes the grid and is remembered after a reload", async ({ page }) => {
    await gallery(page); await page.goto("/en");
    await expect(cards(page)).toHaveCount(4);
    if (touch()) await viewOptions(page);
    const slider = page.getByRole("slider", { name: en.tasks.densityLabel });
    const height = async () => (await card(page, "gallery-b:0").boundingBox())!.height;
    const start = await height();
    await slider.focus();
    await page.keyboard.press("End");
    await expect.poll(height).toBeGreaterThan(start);
    const large = await height();
    await page.reload();
    await expect(cards(page)).toHaveCount(4);
    await expect.poll(height).toBeCloseTo(large, 0);
});

test("the open preview reuses, copies and sends its image to the composer", async ({ page, context }, info) => {
    if (info.project.name.includes("chromium")) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await gallery(page); await page.goto("/en");
    const open = async () => {
        await card(page, "gallery-b:0").getByRole("button", { name: new RegExp(`^${en.tasks.preview} - `) }).click();
        return page.getByRole("dialog");
    };
    let dialog = await open();
    const toolbar = dialog.getByRole("toolbar", { name: en.tasks.previewActions });
    await expect(toolbar.getByRole("link", { name: en.tasks.downloadImage })).toHaveAttribute("href", /\/api\/download\/gallery-b\?index=0/);
    if (info.project.name.includes("chromium")) {
        await toolbar.getByRole("button", { name: en.tasks.copyPrompt }).click();
        await expect(dialog.getByRole("status").filter({ hasText: en.tasks.promptCopied })).toHaveCount(1);
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("A modern house in the forest");
    }
    await toolbar.getByRole("button", { name: en.tasks.reusePrompt }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-studio-composer]").getByRole("textbox")).toHaveValue("A modern house in the forest");
    dialog = await open();
    await dialog.getByRole("toolbar", { name: en.tasks.previewActions }).getByRole("button", { name: en.tasks.reference }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("[data-studio-composer]").getByRole("button", { name: en.commandBar.removeAttachment.replace("{name}", en.commandBar.urlReference) })).toBeVisible();
    dialog = await open();
    await dialog.getByRole("toolbar", { name: en.tasks.previewActions }).getByRole("button", { name: en.tasks.delete }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: en.tasks.cancel, exact: true }).click();
    await expect(cards(page)).toHaveCount(4);
});
