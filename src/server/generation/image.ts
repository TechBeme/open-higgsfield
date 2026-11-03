import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { getRuntimeCapability } from "@/server/catalog/runtime";
import { readModelMedia, uploadModelMedia } from "@/server/generation/media-input";
import { parseModelFields, validateModelParams } from "@/models/parameter-schema";
import { getMagnificContract } from "@/server/catalog/magnific";
import { submitGeneration } from "@/server/generation/service";
import { objectField, preprocessingFailure, submissionFailure } from "@/server/generation/input";
import { guardWorkspaceRequest } from "@/server/security/workspace-access";
import { assertGenerationEnabled } from "@/server/config/production";
import { readGenerationForm, requestFailure } from "@/server/http/request-limits";
import type { CanonicalParams } from "@/models/canonical";
import type { ImageModelCapability } from "@/models/capabilities/types";
import { submissionIdentity } from "@/lib/submission-identity";


function rejection(error: string) {
  return NextResponse.json({ error, accepted: false, recovery_required: false }, { status: 400 });
}

export async function submitImageRequest(req: NextRequest) {
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
  const caps = await getRuntimeCapability("image", modelId);
  if (!caps) {
    return rejection("ERR_UNKNOWN_IMAGE_MODEL");
  }

  if (caps.provider === "magnific" && !getMagnificContract(caps.provider_model_id, "image")) {
    return rejection("ERR_NO_ADAPTER");
  }

  // ── Build canonical params ────────────────────────────────────────────────
  const prompt = String(form.get("prompt") ?? "").trim();
  if (caps.prompt_required && !prompt) {
    return rejection("ERR_PROMPT_REQUIRED");
  }

  if (prompt.length > (caps.prompt_max ?? 2500)) return rejection("ERR_PROMPT_TOO_LONG");
  const parsedFields = parseModelFields(caps, objectField(form, "field_values", "ERR_INVALID_FIELD_VALUES"));
  if (parsedFields.errors.length) return rejection("ERR_INVALID_FIELD_VALUES");
  const fieldValues = parsedFields.values;

  const params: CanonicalParams = {
    model_id: modelId,
    prompt,
    aspect_ratio: String(fieldValues.aspect_ratio ?? form.get("size_aspect") ?? (caps as ImageModelCapability).size_ui?.default_aspect ?? ""),
    resolution: String(fieldValues.resolution ?? form.get("size_resolution") ?? (caps as ImageModelCapability).size_ui?.default_resolution ?? ""),
    seed: typeof fieldValues.seed === "number" ? fieldValues.seed : undefined,
    field_values: fieldValues,
  };

  const validationErrors = validateModelParams(caps, params);
  if (validationErrors.length) return rejection("ERR_INVALID_MODEL_PARAMS");
  const slots = readModelMedia(form, caps, "image");
  const { media, localUrls: slotLocalUrls } = await uploadModelMedia(slots, signal);

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
      reuseState: { fieldValues, slotLocalUrls, ...submissionIdentity(form) },
    });
    const { httpStatus, ...body } = result;
    return NextResponse.json(body, { status: httpStatus });
  } catch (err) {
    return submissionFailure(err, signal);
  }
}
