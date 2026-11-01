import { NextRequest, NextResponse } from "next/server";
import { VIDEO_CAPABILITIES } from "@/models/capabilities/video";
import { getVideoAdapter } from "@/models/adapters/video";
import { submitGeneration } from "@/lib/generation-service";
import { processImageUpload, processFileUpload, resolveUrl } from "@/lib/media-upload";
import { safeErrorCode } from "@/lib/task-runtime";
import { elementCounts, inputFile, objectField, objectValue, preprocessingFailure } from "@/lib/generation-input";
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
  // ── Parse canonical params from FormData ─────────────────────────────────
  const modelId = String(form.get("model_id") ?? "").trim();
  const caps = VIDEO_CAPABILITIES[modelId];
  if (!caps) {
    return rejection("ERR_UNKNOWN_MODEL");
  }
  const adapter = (caps.provider ?? "freepik") === "freepik" ? getVideoAdapter(modelId) : undefined;
  if ((caps.provider ?? "freepik") === "freepik" && !adapter) {
    return rejection("ERR_NO_ADAPTER");
  }

  const settings = objectField(form, "settings", "ERR_INVALID_SETTINGS");
  const referenceCounts = elementCounts(form, caps.elements);

  const prompt = String(form.get("prompt") ?? "").trim();
  if (caps.prompt_required && !prompt) {
    return rejection("ERR_PROMPT_REQUIRED");
  }
  const promptMax = caps.prompt_max ?? 2500;
  if (prompt && prompt.length > promptMax) {
    return rejection("ERR_PROMPT_TOO_LONG");
  }

  // Build canonical params from settings
  const fieldValues = settings.fieldValues === undefined ? {} : objectValue(settings.fieldValues, "ERR_INVALID_FIELD_VALUES");
  const canonicalParams: CanonicalParams = {
    model_id: modelId,
    prompt,
    negative_prompt: caps.negative_prompt ? String(settings.negativePrompt ?? "").trim() || undefined : undefined,
    duration: caps.duration ? String(settings.duration ?? (caps.duration as { default?: string }).default ?? "") : undefined,
    aspect_ratio: caps.aspect_ratio ? String(settings.aspectRatio ?? "") || undefined : undefined,
    resolution: caps.resolution_variant ? String(form.get("variant_id") ?? (caps.resolution_variant as { default?: string }).default ?? "") || undefined : undefined,
    size: String(settings.size ?? "") || undefined,
    cfg_scale: caps.cfg_scale ? Number(settings.cfgScale ?? 0.5) : undefined,
    seed: (() => { const s = parseInt(String(settings.seed ?? "-1"), 10); return !isNaN(s) && s !== -1 ? s : undefined; })(),
    style: caps.style ? String(settings.style ?? "") || undefined : undefined,
    expand_prompt: caps.prompt_expansion ? Boolean(settings.expandPrompt) : undefined,
    shot_type: caps.shot_type ? String(settings.shotType ?? "") || undefined : undefined,
    field_values: fieldValues,
  };

  // ── Validate params against capabilities ─────────────────────────────────
  const validationErrors = adapter?.validate(modelId, canonicalParams, caps) ?? [];
  if (validationErrors.length > 0) {
    return rejection(validationErrors[0]);
  }

  // ── Process media uploads ────────────────────────────────────────────────
  const images: Record<string, string> = {};
  let videoUrl: string | undefined;
  let audioUrl: string | undefined;

  for (const slot of caps.media_slots) {
    signal.throwIfAborted();
    const value = form.get(`file_${slot.id}`);
    const file = value instanceof File ? value : null;
    let url = String(form.get(`url_${slot.id}`) ?? "").trim();
    if (file && file.size > 0) {
      const kindMime = slot.kind === "video" ? "video/mp4" : slot.kind === "audio" ? "audio/mpeg" : "image/jpeg";
      const buf = await inputFile(file, kindMime, signal);
      const result = slot.kind === "image"
        ? await processImageUpload(buf, { signal })
        : await processFileUpload(buf, file.name, file.type || kindMime, { signal });
      url = result.remoteUrl;
    } else if (url) url = (await resolveUrl(url, { signal })).remoteUrl;
    if (url) {
      if (slot.kind === "video") videoUrl = url;
      else if (slot.kind === "audio") audioUrl = url;
      else images[slot.id] = url;
    } else if (slot.required) return rejection("ERR_SLOT_REQUIRED");
  }

  const elementsPayload: Array<{ frontal_image_url?: string; reference_image_urls?: string[] }> = [];
  for (const [i, refCount] of referenceCounts.entries()) {
    signal.throwIfAborted();
    const frontalValue = form.get(`file_elem_${i}_frontal`);
    const frontalFile = frontalValue instanceof File ? frontalValue : null;
    let frontalUrl = String(form.get(`url_elem_${i}_frontal`) ?? "").trim();
    if (frontalFile && frontalFile.size > 0) {
      const buffer = await inputFile(frontalFile, "image/jpeg", signal);
      frontalUrl = (await processImageUpload(buffer, { signal })).remoteUrl;
    } else if (frontalUrl) frontalUrl = (await resolveUrl(frontalUrl, { signal })).remoteUrl;
    const refUrls: string[] = [];
    for (let j = 0; j < refCount; j++) {
      signal.throwIfAborted();
      const refValue = form.get(`file_elem_${i}_ref_${j}`);
      const refFile = refValue instanceof File ? refValue : null;
      let refUrl = String(form.get(`url_elem_${i}_ref_${j}`) ?? "").trim();
      if (refFile && refFile.size > 0) {
        const buffer = await inputFile(refFile, "image/jpeg", signal);
        refUrl = (await processImageUpload(buffer, { signal })).remoteUrl;
      } else if (refUrl) refUrl = (await resolveUrl(refUrl, { signal })).remoteUrl;
      if (refUrl) refUrls.push(refUrl);
    }
    const element: { frontal_image_url?: string; reference_image_urls?: string[] } = {};
    if (frontalUrl) element.frontal_image_url = frontalUrl;
    if (refUrls.length) element.reference_image_urls = refUrls;
    if (frontalUrl || refUrls.length) elementsPayload.push(element);
  }

  const media: CanonicalMediaInputs = {
    images: Object.keys(images).length > 0 ? images : undefined,
    video: videoUrl,
    audio: audioUrl,
    elements: elementsPayload.length > 0 ? elementsPayload : undefined,
  };

  signal.throwIfAborted();

  // ── Submit through the selected provider ─────────────────────────────────
  try {
    const result = await submitGeneration({
      signal,
      mediaType: "video",
      modelId,
      capabilities: caps,
      params: canonicalParams,
      media,
      reuseState: { settings },
    });
    const { httpStatus, ...body } = result;
    return NextResponse.json(body, { status: httpStatus });
  } catch (err) {
    const cancelled = signal.aborted || safeErrorCode(err) === "ERR_REQUEST_CANCELLED";
    return NextResponse.json({ error: cancelled ? "ERR_REQUEST_CANCELLED" : "ERR_TASK_STORAGE_UNAVAILABLE", accepted: false, recovery_required: false }, { status: cancelled ? 408 : 503 });
  }
}
