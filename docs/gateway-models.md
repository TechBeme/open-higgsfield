# AI Gateway media catalog

This catalog is generated from the reviewed snapshot of `https://ai-gateway.vercel.sh/v1/models` on 2026-11-01 and the official AI SDK/Vercel provider documentation listed below. The executable capability registry is [gateway.ts](../src/server/catalog/gateway.ts).

The registry exposes all 84 media-output entries discovered at review time (37 image, 39 video, and 8 language-image entries). Video duration, aspect ratio, resolution, FPS, operation, audio, sample count, and input limits are copied from the Gateway catalog. Vendor fields are declared only where current official provider documentation defines their type and bounds. Operational values such as polling intervals, webhooks, routing, provider order, credentials, arbitrary storage URIs, and callback secrets remain server-owned.

## Official references

- [AI Gateway model catalog](https://ai-gateway.vercel.sh/v1/models)
- [Vercel image generation](https://vercel.com/docs/ai-gateway/modalities/image-generation)
- [Vercel video generation](https://vercel.com/docs/ai-gateway/modalities/video-generation)
- [AI SDK image generation](https://ai-sdk.dev/docs/ai-sdk-core/image-generation)
- [AI SDK video generation](https://ai-sdk.dev/docs/ai-sdk-core/video-generation)
- [AI SDK provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/)

## Safety and limits

Gateway model IDs are resolved against the checked-in catalog before a request is dispatched. Unknown controls and unsupported combinations fail closed. Requests use one bounded transport attempt with `maxRetries: 0`; a successful remote start is represented by an opaque persisted operation and polled by model ID. Public output URLs are validated before persistence.

Quiver Arrow emits SVG. The adapter rejects DTD/entities, external references, event handlers, styles, scripts, oversized documents, and unsafe elements, then rasterizes accepted SVG to PNG with Sharp and strict pixel/byte limits. TIFF and other non-public raster formats are likewise normalized to PNG. An SVG that cannot be safely rasterized fails closed.

Topaz Wonder requires one image and does not support prompt, seed, aspect ratio, masks, or more than one output. Topaz video models require one input video and expose only the documented source/output structures; undocumented filter ranges are intentionally not guessed because the official filter pages were unavailable during review.

Recraft’s native API documents additional operations and fields, but no current AI SDK Gateway namespace contract was published during this review. The registry therefore advertises only the documented unified controls for Recraft instead of silently passing native fields that Gateway may reject.
