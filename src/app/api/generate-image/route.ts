import { NextRequest, NextResponse } from "next/server";
import { IMAGE_CAPABILITIES } from "@/models/capabilities/image";
import { getImageAdapter } from "@/models/adapters/image";
import { saveInputLocally, uploadToTmpfiles } from "@/lib/upload";
import { submitGeneration } from "@/lib/generation-service";
import { publicErrorMessage } from "@/lib/public-error";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const form = await req.formData();

  // ── Model lookup ──────────────────────────────────────────────────────────
  const modelId = String(form.get("model_id") ?? "").trim();
  const caps = IMAGE_CAPABILITIES[modelId];
  if (!caps) {
    return NextResponse.json({ error: `ERR_UNKNOWN_IMAGE_MODEL: ${modelId}` }, { status: 400 });
  }

  const adapter = (caps.provider ?? "freepik") === "freepik" ? getImageAdapter(modelId) : undefined;
  if ((caps.provider ?? "freepik") === "freepik" && !adapter) {
    return NextResponse.json({ error: `ERR_NO_ADAPTER: ${modelId}` }, { status: 400 });
  }

  // ── Build canonical params ────────────────────────────────────────────────
  const prompt = String(form.get("prompt") ?? "").trim();
  if (caps.prompt_required && !prompt) {
    return NextResponse.json({ error: "ERR_PROMPT_REQUIRED" }, { status: 400 });
  }

  let fieldValues: Record<string, unknown> = {};
  try { fieldValues = JSON.parse(String(form.get("field_values") ?? "{}")); } catch { }

  const params: CanonicalParams = {
    model_id: modelId,
    prompt,
    aspect_ratio: String(form.get("size_aspect") ?? caps.size_ui?.default_aspect ?? ""),
    resolution: String(form.get("size_resolution") ?? caps.size_ui?.default_resolution ?? ""),
    seed: Number.isFinite(Number(fieldValues.seed)) ? Number(fieldValues.seed) : undefined,
    field_values: fieldValues,
  };

  // ── Slot processing ───────────────────────────────────────────────────────
  const media: CanonicalMediaInputs = {};
  const slotLocalUrls: Record<string, string[]> = {};

  // Determine active slots — check both base media_slots and edit_variant slots
  const allSlotIds = [
    ...caps.media_slots.map((s) => s.id),
    ...(caps.has_edit_variant ? ["reference_images"] : []),
  ];

  for (const slotId of allSlotIds) {
    const files: File[] = [];
    const formEntries = form.getAll(`slot_${slotId}`);
    for (const entry of formEntries) {
      if (entry instanceof File && entry.size > 0) files.push(entry);
    }
    if (files.length === 0) continue;

    const slot = caps.media_slots.find((s) => s.id === slotId);
    if (!slot) {
      // edit_variant slot (e.g. reference_images for Seedream)
      const converted: string[] = [];
      for (const file of files) {
        const buf = Buffer.from(await file.arrayBuffer());
        const ext = file.name.split(".").pop() ? `.${file.name.split(".").pop()}` : ".jpg";
        const mimeType = file.type || "image/jpeg";
        const localUrl = await saveInputLocally(buf, ext);
        slotLocalUrls[slotId] = [...(slotLocalUrls[slotId] ?? []), localUrl];
        const remoteUrl = await uploadToTmpfiles(buf, `file${ext}`, mimeType);
        converted.push(remoteUrl);
      }
      media.images = { ...media.images, [slotId]: converted.length === 1 ? converted[0] : converted as unknown as string };
      continue;
    }

    const converted: string[] = [];
    for (const file of files) {
      const buf = Buffer.from(await file.arrayBuffer());
      const ext = file.name.split(".").pop() ? `.${file.name.split(".").pop()}` : ".jpg";
      const mimeType = file.type || "image/jpeg";
      const localUrl = await saveInputLocally(buf, ext);
      slotLocalUrls[slotId] = [...(slotLocalUrls[slotId] ?? []), localUrl];
      const remoteUrl = await uploadToTmpfiles(buf, `file${ext}`, mimeType);
      converted.push(remoteUrl);
    }

    media.images = { ...media.images, [slotId]: slot.accept === "b64_only" ? converted[0] : converted[0] };
  }

  // Validate required slots
  for (const slot of caps.media_slots) {
    if (slot.required && (!media.images || !media.images[slot.id])) {
      return NextResponse.json({ error: `ERR_SLOT_REQUIRED: ${slot.label}` }, { status: 400 });
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  try {
    const taskId = await submitGeneration({
      mediaType: "image",
      modelId,
      capabilities: caps,
      params,
      media,
      reuseState: { fieldValues, slotLocalUrls },
    });
    return NextResponse.json({ task_id: taskId });
  } catch (err) {
    const msg = publicErrorMessage(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
