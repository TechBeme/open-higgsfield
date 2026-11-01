import { NextRequest, NextResponse } from "next/server";
import { IMAGE_CAPABILITIES } from "@/models/capabilities/image";
import { getImageAdapter } from "@/models/adapters/image";
import { saveInputLocally, uploadToTmpfiles } from "@/lib/upload";
import { submitGeneration } from "@/lib/generation-service";
import { safeErrorCode } from "@/lib/task-runtime";
import { inputFile, objectField, preprocessingFailure } from "@/lib/generation-input";
import { guardWorkspaceRequest } from "@/lib/workspace-access";
import { assertGenerationEnabled } from "@/lib/production-config";
import { readGenerationForm, requestFailure } from "@/lib/request-limits";
import type { CanonicalParams, CanonicalMediaInputs } from "@/models/canonical";

export const runtime = "nodejs";
export const maxDuration = 300;

function rejection(error: string) {
  return NextResponse.json({ error, accepted: false, recovery_required: false }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const denial = guardWorkspaceRequest(req);
  if (denial) return denial;
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(270_000)]);
  let form: FormData;
  try {
    assertGenerationEnabled();
    form = await readGenerationForm(req, { signal });
  } catch (error) { return requestFailure(error); }

  try { return await prepareGeneration(form, signal); }
  catch (error) { return preprocessingFailure(error, signal); }
}

async function prepareGeneration(form: FormData, signal: AbortSignal) {
  signal.throwIfAborted();
  // ── Model lookup ──────────────────────────────────────────────────────────
  const modelId = String(form.get("model_id") ?? "").trim();
  const caps = IMAGE_CAPABILITIES[modelId];
  if (!caps) {
    return rejection("ERR_UNKNOWN_IMAGE_MODEL");
  }

  const adapter = (caps.provider ?? "freepik") === "freepik" ? getImageAdapter(modelId) : undefined;
  if ((caps.provider ?? "freepik") === "freepik" && !adapter) {
    return rejection("ERR_NO_ADAPTER");
  }

  // ── Build canonical params ────────────────────────────────────────────────
  const prompt = String(form.get("prompt") ?? "").trim();
  if (caps.prompt_required && !prompt) {
    return rejection("ERR_PROMPT_REQUIRED");
  }

  if (prompt.length > (caps.prompt_max ?? 2500)) return rejection("ERR_PROMPT_TOO_LONG");
  const fieldValues = objectField(form, "field_values", "ERR_INVALID_FIELD_VALUES");

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
    signal.throwIfAborted();
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
        const buf = await inputFile(file, "image/jpeg", signal);
        const ext = file.name.split(".").pop() ? `.${file.name.split(".").pop()}` : ".jpg";
        const mimeType = file.type || "image/jpeg";
        const localUrl = await saveInputLocally(buf, ext, { signal });
        slotLocalUrls[slotId] = [...(slotLocalUrls[slotId] ?? []), localUrl];
        const remoteUrl = await uploadToTmpfiles(buf, `file${ext}`, mimeType, { signal });
        converted.push(remoteUrl);
      }
      media.images = { ...media.images, [slotId]: converted.length === 1 ? converted[0] : converted as unknown as string };
      continue;
    }

    const converted: string[] = [];
    for (const file of files) {
      const buf = await inputFile(file, "image/jpeg", signal);
      const ext = file.name.split(".").pop() ? `.${file.name.split(".").pop()}` : ".jpg";
      const mimeType = file.type || "image/jpeg";
      const localUrl = await saveInputLocally(buf, ext, { signal });
      slotLocalUrls[slotId] = [...(slotLocalUrls[slotId] ?? []), localUrl];
      const remoteUrl = await uploadToTmpfiles(buf, `file${ext}`, mimeType, { signal });
      converted.push(remoteUrl);
    }

    media.images = { ...media.images, [slotId]: slot.accept === "b64_only" ? converted[0] : converted[0] };
  }

  // Validate required slots
  for (const slot of caps.media_slots) {
    if (slot.required && (!media.images || !media.images[slot.id])) {
      return rejection("ERR_SLOT_REQUIRED");
    }
  }

  signal.throwIfAborted();

  // ── Submit ────────────────────────────────────────────────────────────────
  try {
    const result = await submitGeneration({
      signal,
      mediaType: "image",
      modelId,
      capabilities: caps,
      params,
      media,
      reuseState: { fieldValues, slotLocalUrls },
    });
    const { httpStatus, ...body } = result;
    return NextResponse.json(body, { status: httpStatus });
  } catch (err) {
    const cancelled = signal.aborted || safeErrorCode(err) === "ERR_REQUEST_CANCELLED";
    return NextResponse.json({ error: cancelled ? "ERR_REQUEST_CANCELLED" : "ERR_TASK_STORAGE_UNAVAILABLE", accepted: false, recovery_required: false }, { status: cancelled ? 408 : 503 });
  }
}
