import type { Page, Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, mockWorkspace, expectWithinViewport } from "./fixtures";
import en from "../../src/messages/en.json";
import pt from "../../src/messages/pt-BR.json";
import es from "../../src/messages/es.json";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWO4+t8dK2IYWhIAylSGwYMD4fAAAAAASUVORK5CYII=", "base64");
const imageId = "toapis__qwen-image-3.0-pro";
const videoId = "magnific__video__seedance_2_5_pro_480p";
const generate = (page: Page) => page.getByRole("button", { name: new RegExp(`^${en.common.generate}`) });
const composer = (page: Page) => page.locator("[data-studio-composer]");
const attachments = (page: Page) => composer(page).getByRole("button", { name: /^Remove / });

async function setup(page: Page) {
    const state = await mockWorkspace(page);
    state.catalog.images = [state.catalog.images.find(model => model.id === imageId)!];
    state.catalog.videos = [state.catalog.videos.find(model => model.id === videoId)!];
    await page.route("https://images.example.test/**", route => route.fulfill({ contentType: "image/png", body: png }));
    await page.route("**/api/download/**", route => route.fulfill({ contentType: "image/png", body: png }));
    return state;
}
async function dropFile(page: Page, name = "synthetic-reference.png", type = "image/png") {
    const dataTransfer = await page.evaluateHandle(({ name, type, bytes }) => {
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array(bytes)], name, { type }));
        return data;
    }, { name, type, bytes: Array.from(png) });
    await composer(page).dispatchEvent("drop", { dataTransfer });
    await dataTransfer.dispose();
}
async function dropUri(page: Page, type: "text/uri-list" | "text/html", value: string) {
    const dataTransfer = await page.evaluateHandle(({ type, value }) => {
        const data = new DataTransfer(); data.setData(type, value); return data;
    }, { type, value });
    await page.locator("body").dispatchEvent("dragenter", { dataTransfer });
    await composer(page).dispatchEvent("drop", { dataTransfer });
    await dataTransfer.dispose();
}
async function submittedForm(route: Route) {
    const request = route.request();
    return new Response(new Uint8Array(request.postDataBuffer()!), { headers: { "content-type": (await request.headerValue("content-type"))! } }).formData();
}

test("prompt accepts file drops, previews and clipboard images while respecting reference limits", async ({ page }) => {
    await setup(page);
    await page.goto("/en");
    await expect(generate(page)).toBeEnabled();
    await dropFile(page);
    await expect(attachments(page)).toHaveCount(1);
    await expect(composer(page).locator('img[src^="blob:"]')).toHaveCount(1);
    await composer(page).getByRole("button", { name: /^Preview reference:/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: en.tasks.zoomIn, exact: true }).click();
    await expect(page.locator("[data-image-viewport]")).toHaveAttribute("data-zoom", "1.25");
    await page.keyboard.press("Escape");
    await composer(page).getByRole("textbox").evaluate((element, bytes) => {
        const clipboardData = new DataTransfer();
        clipboardData.items.add(new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }));
        const event = new Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(event, "clipboardData", { value: clipboardData });
        element.dispatchEvent(event);
    }, Array.from(png));
    await expect(attachments(page)).toHaveCount(2);
    await dropFile(page, "third.png");
    await dropFile(page, "excess.png");
    await expect(attachments(page)).toHaveCount(3);
    await expect(page.getByText(en.errors.ERR_ATTACHMENT_LIMIT)).toBeVisible();
    await attachments(page).first().click();
    await dropFile(page, "wrong.txt", "text/plain");
    await expect(attachments(page)).toHaveCount(2);
    await expect(page.getByText(en.errors.ERR_UNSUPPORTED_MEDIA_TYPE)).toBeVisible();
});

test("browser image HTML and URI drops show real previews and submit URL references", async ({ page }) => {
    await setup(page);
    const forms: FormData[] = [];
    await page.route("**/api/generate-image", async route => {
        forms.push(await submittedForm(route));
        await route.fulfill({ status: 400, json: { error: "ERR_INVALID_FIELD_VALUES", accepted: false, recovery_required: false } });
    });
    await page.goto("/en");
    await expect(generate(page)).toBeEnabled();
    await dropUri(page, "text/html", '<a href="https://example.test/page"><img src="https://images.example.test/html.png"></a>');
    await dropUri(page, "text/uri-list", "# Image\r\nhttps://images.example.test/uri.png");
    await expect(attachments(page)).toHaveCount(2);
    await expect(composer(page).locator('img[src^="https://images.example.test/"]')).toHaveCount(2);
    await expect.poll(() => composer(page).locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBeTruthy();
    await dropUri(page, "text/uri-list", "javascript:alert('invalid')");
    await expect(attachments(page)).toHaveCount(2);
    await composer(page).getByRole("textbox").fill("Synthetic URI references");
    await generate(page).click();
    await expect.poll(() => forms.length).toBe(1);
    expect(forms[0].getAll("url_reference_images")).toEqual(["https://images.example.test/html.png", "https://images.example.test/uri.png"]);
    expect(forms[0].getAll("slot_reference_images")).toHaveLength(0);
});

for (const [locale, m] of Object.entries({ en, "pt-BR": pt, es })) {
    test(`${locale}: URL entry has thumbnails in popup and composer, accessible zoom controls and no overflow`, async ({ page }, info) => {
        await setup(page);
        await page.goto(`/${locale}`);
        await page.getByRole("button", { name: m.commandBar.attach, exact: true }).click();
        const field = page.getByRole("region", { name: m.commandBar.slots.reference_images, exact: true });
        await field.getByRole("button", { name: m.commandBar.url, exact: true }).click();
        await field.getByRole("textbox").fill("https://images.example.test/reference.png");
        await field.getByRole("button", { name: m.commandBar.add, exact: true }).click();
        await expect(field.locator('img[src="https://images.example.test/reference.png"]')).toBeVisible();
        await page.keyboard.press("Escape");
        const thumbnail = composer(page).getByRole("button", { name: m.commandBar.previewReference.replace("{name}", m.commandBar.urlReference), exact: true });
        await expect(thumbnail.locator("img")).toBeVisible();
        await thumbnail.click();
        await page.getByRole("button", { name: m.tasks.zoomIn, exact: true }).click();
        await expect(page.locator("[data-image-viewport]")).toHaveAttribute("data-zoom", "1.25");
        await expectWithinViewport(page);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
        await page.screenshot({ path: info.outputPath(`${locale}-reference-zoom.png`) });
        await page.keyboard.press("Escape");
        await expect(thumbnail).toBeFocused();
    });
}

test("generated images drag back into the prompt with the original output index", async ({ page }) => {
    const state = await setup(page);
    state.history = [{ task_id: "synthetic-generated", model_id: imageId, media_type: "image", status: "COMPLETED", created_at: "2026-11-03T00:00:00Z", prompt: "Synthetic generated image", has_download: true, result_count: 2, _done: true }];
    const forms: FormData[] = [];
    await page.route("**/api/generate-image", async route => {
        forms.push(await submittedForm(route));
        await route.fulfill({ status: 400, json: { error: "ERR_INVALID_FIELD_VALUES", accepted: false, recovery_required: false } });
    });
    await page.goto("/en");
    const output = page.getByRole("button", { name: new RegExp(`^${en.tasks.preview} - `) }).nth(1);
    await expect(output).toBeVisible();
    await output.dragTo(composer(page), { steps: 12 });
    await expect(attachments(page)).toHaveCount(1);
    await expect(composer(page).locator('img[src="/api/download/synthetic-generated?index=1&inline=1"]')).toBeVisible();
    await composer(page).getByRole("textbox").fill("Reuse second image");
    await generate(page).click();
    await expect.poll(() => forms.length).toBe(1);
    expect(forms[0].getAll("url_reference_images")).toEqual(["/api/download/synthetic-generated?index=1&inline=1"]);
});

test("generated image viewer supports button, wheel, keyboard, double-click zoom, panning and image reset", async ({ page }, info) => {
    const state = await setup(page);
    state.history = [{ task_id: "synthetic-zoom", model_id: imageId, media_type: "image", status: "COMPLETED", created_at: "2026-11-03T00:00:00Z", prompt: "Synthetic zoom image", has_download: true, result_count: 2, _done: true }];
    await page.goto("/en");
    await page.getByRole("button", { name: new RegExp(`^${en.tasks.preview} - `) }).first().click();
    const viewport = page.locator("[data-image-viewport]");
    await viewport.focus();
    await page.keyboard.press("+");
    await expect(viewport).toHaveAttribute("data-zoom", "1.25");
    await viewport.dispatchEvent("wheel", { deltaY: -200 });
    await expect.poll(() => viewport.getAttribute("data-zoom")).not.toBe("1.25");
    const bounds = (await viewport.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 35, bounds.y + bounds.height / 2 + 25); await page.mouse.up();
    await expect(viewport.locator("img")).not.toHaveAttribute("style", /translate\(0px, 0px\)/);
    await page.getByRole("button", { name: en.tasks.next, exact: true }).click();
    await expect(viewport).toHaveAttribute("data-zoom", "1.00");
    await viewport.dblclick();
    await expect(viewport).toHaveAttribute("data-zoom", "2.00");
    await page.getByRole("button", { name: en.tasks.zoomReset, exact: true }).click();
    await expect(viewport).toHaveAttribute("data-zoom", "1.00");
    await expectWithinViewport(page);
    await page.screenshot({ path: info.outputPath("generated-image-viewer.png") });
});

test("multiple submissions stay independent through API delays, navigation, errors and uncertain responses", async ({ page }) => {
    await setup(page);
    const pending: { route: Route; form: FormData }[] = [];
    await page.route("**/api/generate-image", async route => { pending.push({ route, form: await submittedForm(route) }); });
    await page.goto("/en");
    await composer(page).getByRole("textbox").fill("First independent request");
    await generate(page).click();
    await expect(page.getByText(en.tasks.sending, { exact: true })).toHaveCount(1);
    await expect(generate(page)).toBeEnabled();
    await composer(page).getByRole("textbox").fill("Second independent request");
    await generate(page).click();
    await expect.poll(() => pending.length).toBe(2);
    await expect(page.locator("[data-submission-id]")).toHaveCount(2);
    expect(pending[0].form.get("prompt")).toBe("First independent request");
    expect(pending[1].form.get("prompt")).toBe("Second independent request");
    await page.getByRole("link", { name: en.workspace.providers, exact: true }).click();
    await page.getByRole("link", { name: en.workspace.studio, exact: true }).click();
    await expect(page.locator("[data-submission-id]")).toHaveCount(2);
    await pending[1].route.fulfill({ status: 400, json: { error: "ERR_INVALID_FIELD_VALUES", accepted: false, recovery_required: false } });
    await expect(page.getByText(en.errors.ERR_INVALID_FIELD_VALUES)).toBeVisible();
    await expect(page.getByText(en.tasks.sending, { exact: true })).toHaveCount(1);
    await pending[0].route.fulfill({ status: 200, contentType: "text/html", body: "Synthetic malformed upstream response" });
    await expect(page.getByText(en.errors.ERR_SUBMISSION_OUTCOME_UNKNOWN)).toBeVisible();
    await expect(generate(page)).toBeEnabled();
    await composer(page).getByRole("textbox").fill("Third new request");
    await generate(page).click();
    await expect.poll(() => pending.length).toBe(3);
    await pending[2].route.fulfill({ status: 400, json: { error: "ERR_INVALID_MODEL_PARAMS", accepted: false, recovery_required: false } });
    await expect(page.getByText(en.errors.ERR_INVALID_MODEL_PARAMS)).toBeVisible();
    expect(pending.length).toBe(3);
});

test("a task discovered during upload/API wait replaces its optimistic card without duplicates", async ({ page }) => {
    const state = await setup(page);
    let pending: Route | undefined;
    await page.route("**/api/generate-image", async route => {
        pending = route;
        const form = await submittedForm(route);
        state.history = [{ task_id: "synthetic-correlated", model_id: imageId, media_type: "image", status: "IN_PROGRESS", prompt: "Synthetic correlated request", created_at: new Date().toISOString(), reuse_state: { clientSubmissionId: form.get("client_submission_id") } }];
    });
    await page.goto("/en");
    await composer(page).getByRole("textbox").fill("Synthetic correlated request");
    await generate(page).click();
    await expect(page.locator("[data-submission-id]")).toHaveCount(1);
    await expect(page.getByText(en.tasks.waiting, { exact: true })).toHaveCount(1);
    await expect(page.locator("[data-submission-id]")).toHaveCount(0);
    await pending!.fulfill({ status: 202, json: { task_id: "synthetic-correlated", accepted: true, recovery_required: false } });
    await expect(page.getByText(en.tasks.waiting, { exact: true })).toHaveCount(1);
    await expect(generate(page)).toBeEnabled();
});

test("video and image requests overlap, and video references accept dropped image URLs with previews", async ({ page }) => {
    await setup(page);
    const pending: { route: Route; form: FormData }[] = [];
    for (const endpoint of ["generate-image", "generate"]) {
        await page.route(`**/api/${endpoint}`, async route => { pending.push({ route, form: await submittedForm(route) }); });
    }
    await page.goto("/en");
    await composer(page).getByRole("textbox").fill("Independent image request");
    await generate(page).click();
    await expect(page.getByText(en.tasks.sending, { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: en.common.video, exact: true }).click();
    await expect(generate(page)).toBeEnabled();
    await dropUri(page, "text/uri-list", "https://images.example.test/video-reference.png");
    await expect(composer(page).locator('img[src="https://images.example.test/video-reference.png"]')).toBeVisible();
    await composer(page).getByRole("textbox").fill("Independent video request");
    await generate(page).click();
    await expect.poll(() => pending.length).toBe(2);
    expect(Array.from(pending[1].form.entries()).filter(([key, value]) => key.startsWith("url_") && value === "https://images.example.test/video-reference.png")).toHaveLength(1);
    await pending[1].route.fulfill({ status: 400, json: { error: "ERR_INVALID_FIELD_VALUES", accepted: false, recovery_required: false } });
    await expect(page.getByText(en.errors.ERR_INVALID_FIELD_VALUES)).toBeVisible();
    await page.getByRole("button", { name: en.common.image, exact: true }).click();
    await expect(page.getByText(en.tasks.sending, { exact: true })).toHaveCount(1);
    await pending[0].route.fulfill({ status: 400, json: { error: "ERR_INVALID_MODEL_PARAMS", accepted: false, recovery_required: false } });
    await expect(page.getByText(en.errors.ERR_INVALID_MODEL_PARAMS)).toBeVisible();
    await expect(generate(page)).toBeEnabled();
});

test("cancelled drags restore the prompt, and broken URL previews have an accessible fallback", async ({ page }) => {
    await setup(page);
    await page.route("https://images.example.test/broken.png", route => route.fulfill({ status: 404, body: "Synthetic missing image" }));
    await page.goto("/en");
    const dataTransfer = await page.evaluateHandle(() => {
        const data = new DataTransfer(); data.setData("text/uri-list", "https://images.example.test/broken.png"); return data;
    });
    await expect(generate(page)).toBeEnabled();
    await page.locator("body").dispatchEvent("dragenter", { dataTransfer });
    await expect(composer(page).getByRole("textbox")).toHaveCount(0);
    await page.locator("body").dispatchEvent("dragend", { dataTransfer });
    await expect(composer(page).getByRole("textbox")).toBeVisible();
    await composer(page).dispatchEvent("drop", { dataTransfer });
    await expect(composer(page).getByLabel(en.commandBar.previewUnavailable)).toBeVisible();
    await composer(page).getByRole("button", { name: /^Preview reference:/ }).click();
    await expect(page.getByText(en.tasks.previewFailed)).toBeVisible();
    await expect(page.getByRole("button", { name: en.tasks.zoomIn, exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await dataTransfer.dispose();
    await expect(generate(page)).toBeEnabled();
});

test("mobile two-finger pinch zooms and resets the image", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-chromium", "Real touch gestures run on the mobile browser project.");
    const state = await setup(page);
    state.history = [{ task_id: "synthetic-pinch", model_id: imageId, media_type: "image", status: "COMPLETED", created_at: "2026-11-03T00:00:00Z", has_download: true, result_count: 1, _done: true }];
    await page.goto("/en");
    await page.getByRole("button", { name: new RegExp(`^${en.tasks.preview} - `) }).click();
    const viewport = page.locator("[data-image-viewport]");
    const bounds = (await viewport.boundingBox())!;
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 75, y, id: 1 }, { x: x + 75, y, id: 2 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => Number(await viewport.getAttribute("data-zoom"))).toBeGreaterThan(1.5);
    await page.getByRole("button", { name: en.tasks.zoomReset, exact: true }).tap();
    await expect(viewport).toHaveAttribute("data-zoom", "1.00");
    await session.detach();
});
