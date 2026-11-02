# Google model support

This catalog follows the Google AI for Developers and Gemini Enterprise Agent Platform documentation retrieved on 1 November 2026. The backend validates the model-specific controls before dispatch and uses one attempt per paid submission. All polling operations persist only a provider identity.

## Images

AI Studio and Vertex expose Gemini Nano Banana 2.1 (`gemini-nano-banana-2.1`), Gemini 3.1 Flash Lite Image (`gemini-3.1-flash-lite-image`), Gemini 3.1 Flash Image (`gemini-3.1-flash-image`), and Gemini 3 Pro Image (`gemini-3-pro-image`). Stable Gemini 2.5 Flash Image (`gemini-2.5-flash-image`) remains available in the Gemini API at the time of this catalog; the preview ID was retired and is not exposed. Nano Banana 2.1 supports 1K/2K/4K and minimal/medium/high thinking; Lite supports 1K and minimal/high thinking; Flash supports 512/1K/2K/4K and minimal/high thinking; Pro supports 1K/2K/4K with fixed thinking. Image reference uploads are bounded to 14 (2.5: up to 3) and video-to-image input is available on the documented newer models. AI Studio search grounding is available only on models whose official model page lists it. Vertex additionally exposes people-generation policy, JPEG MIME output, and JPEG compression quality controls.

## Videos

AI Studio Veo 3.1 preview IDs were shut down on 22 October 2026. Existing saved tasks retain a deprecated adapter entry for recovery, while new selections use `gemini-omni-1.1-flash`. Omni uses background Interactions with a compact interaction ID and authenticated GET polling. Vertex uses `gemini-omni-1.1-flash-preview`, with 3–10 second output, 360p/720p/1080p/4k, and 16:9/9:16; AI Studio exposes the same documented media/format controls where available. Omni accepts text and image/video references; Vertex does not accept audio input. Frame and video roles are encoded in the documented source tags.

Vertex Veo entries are `veo-3.1-generate-001`, `veo-3.1-fast-generate-001`, and preview `veo-3.1-lite-generate-001`. Standard Veo generation supports 4/6/8 seconds, 1–4 outputs, 16:9/9:16, negative prompt, person policy, seed, audio, and 720p/1080p; 4K is available on the standard generate model. Reference generation is limited to three images and 8-second output. Video extension has a documented fixed seven-second extension; the adapter omits the ordinary duration parameter when an input video is supplied.

Imagen generation is not added: the Gemini API documents Imagen as shut down and Vertex Imagen 3/4 endpoints as discontinued with migration guidance to Gemini image models.

Official references: [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation), [Gemini Omni video](https://ai.google.dev/gemini-api/docs/omni), [Gemini video](https://ai.google.dev/gemini-api/docs/video), [Vertex model catalog](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/google-models), and [Vertex Veo 3.1](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate).
