# ToAPIs model contracts

The ToAPIs integration is registry-driven. `src/server/catalog/toapis.ts` is the executable allowlist and contains one contract per documented image/video model and Midjourney action. `src/server/providers/toapis.ts` validates canonical parameters, media roles, conditional combinations, nested metadata schemas, and URL policy before a request is sent.

The registry was reviewed against the official English ToAPIs documentation on 2026-11-01. Every contract retains its exact source URL. Catalog rows without a dedicated parameter page are deliberately not exposed: a marketplace/catalog listing does not establish a safe request schema. This includes `nano_banana`, `nano_banana_2`, `nano_banana_pro`, Gemini Omni underscore catalog aliases without a dedicated route, `wan3.0-video-prime`, and other catalog-only names. Documented aliases are included only where the dedicated page names and describes the alias (`gemini_omni_flash` remains deprecated and is accepted for saved tasks).

Image families include GPT Image 2/2.5 channels, GPT-4o Image, Grok 4.1/4.2 Image, Gemini 2.5/3/3.1 and Nano Banana 2.1 channels, Flux 2/Kontext, Seedream 4/4.5/5/5 Pro, Qwen Image 3, and Vidu image models. Video families include Seedance 1/2/2.5 and extension channels, MiniMax H3/Hailuo, HappyHorse, Kling 2.6/3/4 and Omni/O1, Grok Video/Imagine, Veo 3.1 channels, Gemini Omni channels, Sora 2 channels, Vidu Q3/Ali/Q4, and Wan 2.6/3.

The executable model IDs are:

- Images: `gpt-image-2`, `gpt-image-2-official`, `gpt-image-2-vip`, `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, official/VIP 2.5 channels, `gpt-4o-image`, Grok 4.1/4.2 Image, Gemini 2.5/3/3.1 and Nano Banana 2.1 channels, Flux 2/Kontext, Seedream 4/4.5/5/5 Pro, Qwen Image 3, and Vidu image models. Midjourney is represented by explicit action IDs (`imagine`, `blend`, `edits`, `upscale`, variations, reroll, zoom, pan, inpaint/modal, remix, and video).
- Videos: Seedance 2/2.5 and extension channels, Doubao Seedance 1/1.5, MiniMax H3 and Hailuo 02/2.3, HappyHorse 1.1, Kling v2.6/v3/3 Turbo/v3 Omni/Video O1/4, Grok Video 1.0/1.5 and Imagine official 1.0/1.5, Veo 3.1 fast/quality/lite (official and standard), Gemini Omni legacy/1.1/official channels, Sora 2 official/VVIP, Vidu Q3/Ali/Q4, and Wan 2.6/Flash/3.0.

Controls are represented by canonical controls plus strict custom fields. Dot paths (for example `metadata.thinkingConfig.thinkingBudget`) are rebuilt into nested request objects only after their declared type/range/enum/schema passes. Structured fields use a closed JSON-schema subset with no arbitrary provider passthrough. Media slots preserve semantic roles and ordered arrays; limits, required inputs, mutually exclusive modes, frame/keyframe rules, reference counts, and documented byte limits are checked before dispatch.

## Operational constraints

- ToAPIs requests use the fixed HTTPS origin. The GPT Image 2.5 official channel uses its separately documented `https://api.toapis.com` origin and this origin is persisted in the durable operation identity.
- No generation call is made by the verifier. `scripts/verify-toapis-models.mjs` uses synthetic URLs and a synthetic fetcher only.
- Polling accepts legacy version 1 operations and new version 2 operations. Completion accepts bounded multi-output results, documented image layers, video `mp4`/`mov`/`gif`, and Midjourney's separate result fields. URLs are still restricted to public HTTPS.
- Midjourney uses its separate action routes and status protocol. A `MODAL` status remains recoverable `IN_PROGRESS` with `actionRequired: "mask"`; the task ID is retained so the UI can submit the documented modal mask step. It is not treated as a terminal failure or automatically retried.
- Webhooks, callbacks, business IDs, and off-peak generation are infrastructure choices. User fields are exposed only where a documented model contract and safe local validation exist.

Run `node scripts/verify-toapis-models.mjs` for the ToAPIs contract suite. It covers all registry entries, all advertised ratio/resolution/duration values, multi-role media, scalar and nested schema failures, conditional modes, actions, transport origin, operation identity, multi-output polling, and recoverable Midjourney modal status.

Official index and model catalog: <https://docs.toapis.com/docs/en/api-reference/models.md>.
