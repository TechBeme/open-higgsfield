import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { generationReference, readModelMedia, uploadModelMedia } from "@/server/generation/media-input";
import { parseModelFields, validateModelParams } from "@/models/parameter-schema";
import { getMagnificContract } from "@/server/catalog/magnific";
import { getRuntimeCapability } from "@/server/catalog/runtime";
import { submitGeneration } from "@/server/generation/service";
import { processImageUpload, resolveUrl } from "@/server/media/input-upload";
import { elementCounts, inputFile, objectField, objectValue, preprocessingFailure, submissionFailure } from "@/server/generation/input";
import { guardWorkspaceRequest } from "@/server/security/workspace-access";
import { assertGenerationEnabled } from "@/server/config/production";
import { readGenerationForm, requestFailure } from "@/server/http/request-limits";
import type { CanonicalParams } from "@/models/canonical";
import { submissionIdentity } from "@/lib/submission-identity";


function rejection(error: string) {
  return NextResponse.json({ error, accepted: false, recovery_required: false }, { status: 400 });
}

export async function submitVideoRequest(req: NextRequest) {
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
  const caps = await getRuntimeCapability("video", modelId);
  if (!caps) {
    return rejection("ERR_UNKNOWN_MODEL");
  }
  if (caps.provider === "magnific" && !getMagnificContract(caps.provider_model_id, "video")) {
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
  const parsedFields = parseModelFields(caps, settings.fieldValues === undefined ? {} : objectValue(settings.fieldValues, "ERR_INVALID_FIELD_VALUES"));
  if (parsedFields.errors.length) return rejection("ERR_INVALID_FIELD_VALUES");
  const fieldValues = parsedFields.values;
  const canonicalParams: CanonicalParams = {
    model_id: modelId,
    prompt,
    negative_prompt: caps.negative_prompt ? String(settings.negativePrompt ?? "").trim() || undefined : undefined,
    duration: caps.duration ? String(settings.duration ?? (caps.duration as { default?: string }).default ?? "") : undefined,
    aspect_ratio: caps.aspect_ratio ? String(settings.aspectRatio ?? "") || undefined : undefined,
    resolution: caps.resolution_variant ? String(form.get("variant_id") || (caps.resolution_variant as { default?: string }).default || "") || undefined : undefined,
    size: String(settings.size ?? "") || undefined,
    cfg_scale: caps.cfg_scale ? Number(settings.cfgScale ?? 0.5) : undefined,
    seed: (() => { const s = parseInt(String(settings.seed ?? "-1"), 10); return !isNaN(s) && s !== -1 ? s : undefined; })(),
    style: caps.style ? String(settings.style ?? "") || undefined : undefined,
    expand_prompt: caps.prompt_expansion ? Boolean(settings.expandPrompt) : undefined,
    shot_type: caps.shot_type ? String(settings.shotType ?? "") || undefined : undefined,
    field_values: fieldValues,
  };

  // ── Validate params against capabilities ─────────────────────────────────
  const validationErrors = validateModelParams(caps, canonicalParams);
  if (validationErrors.length > 0) {
    return rejection(validationErrors[0]);
  }

  const slots = readModelMedia(form, caps, "video");
  const { media } = await uploadModelMedia(slots, signal);

  const elementsPayload: Array<{ frontal_image_url?: string; reference_image_urls?: string[] }> = [];
  for (const [i, refCount] of referenceCounts.entries()) {
    signal.throwIfAborted();
    const frontalValue = form.get(`file_elem_${i}_frontal`);
    const frontalFile = frontalValue instanceof File ? frontalValue : null;
    let frontalUrl = String(form.get(`url_elem_${i}_frontal`) ?? "").trim();
    if (frontalFile && frontalFile.size > 0) {
      const buffer = await inputFile(frontalFile, "image/jpeg", signal);
      frontalUrl = generationReference(await processImageUpload(buffer, { signal }));
    } else if (frontalUrl) frontalUrl = generationReference(await resolveUrl(frontalUrl, { signal }));
    const refUrls: string[] = [];
    for (let j = 0; j < refCount; j++) {
      signal.throwIfAborted();
      const refValue = form.get(`file_elem_${i}_ref_${j}`);
      const refFile = refValue instanceof File ? refValue : null;
      let refUrl = String(form.get(`url_elem_${i}_ref_${j}`) ?? "").trim();
      if (refFile && refFile.size > 0) {
        const buffer = await inputFile(refFile, "image/jpeg", signal);
        refUrl = generationReference(await processImageUpload(buffer, { signal }));
      } else if (refUrl) refUrl = generationReference(await resolveUrl(refUrl, { signal }));
      if (refUrl) refUrls.push(refUrl);
    }
    const element: { frontal_image_url?: string; reference_image_urls?: string[] } = {};
    if (frontalUrl) element.frontal_image_url = frontalUrl;
    if (refUrls.length) element.reference_image_urls = refUrls;
    if (frontalUrl || refUrls.length) elementsPayload.push(element);
  }

  media.elements = elementsPayload.length ? elementsPayload : undefined;

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
      reuseState: { settings, ...submissionIdentity(form) },
    });
    const { httpStatus, ...body } = result;
    return NextResponse.json(body, { status: httpStatus });
  } catch (err) {
    return submissionFailure(err, signal);
  }
}
