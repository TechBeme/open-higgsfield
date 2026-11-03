# Runware

Runware is available under **Providers > Runware**. Add one or more API keys,
verify the connection and enable the models you want in the Studio. Alternatively,
set `RUNWARE_API_KEY` on the server. Saved connections take precedence over the
environment, and disabling every connection hides Runware models from the Studio.

The integration uses the official REST API, `POST https://api.runware.ai/v1`,
with Bearer authentication and an array containing one task. Credentials never
reach the browser or task operation records. There is no custom endpoint setting.

## Included models

Official public schemas retrieved on 2026-11-03 define **301 live, callable models**:
**191 image models** and **110 video models**. The generated catalog includes
all entries with an AIR identifier and an image/video output capability in the
[official index](https://runware.ai/docs/models/index.json), including models that
require reference media. Every model is enabled in a fresh installation; saved
preferences determine which models appear in that installation's Studio.

| Official operation | Images | Videos |
| --- | ---: | ---: |
| Image/video inference (generation and editing) | 137 | 101 |
| Upscale | 8 | 8 |
| Remove background | 12 | 1 |
| ControlNet preprocessing | 12 | 0 |
| Image masking | 15 | 0 |
| Vector generation / vectorization | 7 | 0 |
| **Total** | **191** | **110** |

This includes Grok Imagine Image 2.0, Krea 2 Turbo, Z-Image Turbo, Nano Banana 2,
2.1 and Pro, P-Image-Ideogram, GPT-Image-2.5 Flare and Sunburst, Muse Image,
Kling IMAGE 3.0 and O1, together with every other live callable image/video entry.
The source file records each model's AIR, official schema URL, operation,
response URL property and schema digest. Index overview pages without an AIR,
retired/preview entries and audio-only/text/3D/training models are excluded.
Community checkpoints outside the official index remain discovery candidates.

Availability, account access, pricing and credits remain controlled by Runware.
Catalog/schema coverage does not mean every model has been tested with a paid
request. Costs and moderation policies are not inferred from model names.

## Parameters and media

The Studio derives controls from each model's request schema: dimensions,
resolution, duration, output format/quality, seed, guidance, sampling, references
and model settings. Ordinary model settings appear as individual controls;
complex structures such as LoRAs, grounding and explicitly positioned frames use
the existing JSON editor. Property names and enumerated values remain unchanged
in API requests. Interface labels and shared guidance support English, Portuguese
and Spanish.

In **First / last frames**, add the first frame before the last one. Advanced frame JSON and the
ordinary frame upload slot are alternatives; providing both is rejected. Leave
size at **Default** for automatic sizing or a compatible text-generation preset.
Frame-based generation often uses resolution and rejects explicit dimensions.

Before dispatch, Ajv validates the complete official schema, including
`if`/`then`/`else`, `dependentRequired`, `not`, `oneOf`, numeric multiples and
nested constraints. Output area/aspect limits and combined reference counts are
also checked. Invalid combinations do not reach the generation API. The app
limits a task to 16 images or one video, matching its asset storage contract.

File uploads preserve PNG alpha/masks. Local file counts and byte limits are
checked before upload. File-content constraints such as duration, frame rate,
codec and remote-file dimensions are still validated by Runware; local schema
validation does not prove that a media file meets every upstream requirement.
Reference hosting follows the application's existing media storage configuration.

Utility requests use their documented task types and result properties, including
`guideImageURL` and `maskImageURL`. They do not receive inference-only fields such
as `numberResults`. Vector models return SVG from Runware; the app rasterizes it
to PNG before storing, previewing or downloading it. Original editable SVG files
are not retained. This preserves the existing inert image asset contract.
Rendering uses the existing Sharp/librsvg dependency with pixel, byte and time
limits, no file base URI, and rejects XML entities/include directives.

The backend owns task IDs, asynchronous delivery and URL outputs. Webhooks,
arbitrary upload destinations, output TTL overrides and automatic model routing
are deliberately not exposed as model controls.

## Tasks and failures

Image and video requests use `deliveryMethod: "async"`. The task UUID is the
app's generated task ID. The existing worker polls with `getResponse`, using the
same saved connection that submitted the task, and materializes completed assets
into the configured storage before marking the task complete.

An image batch stays in progress until all requested outputs are available.
Partial success mixed with a failure pauses observation for review. HTTP 429/5xx
and network errors during polling use the existing bounded backoff and
`Retry-After` handling. Provider messages and secrets are never copied into
public errors. A missing task or an authentication failure during observation
is not treated as proof that generation failed.

Submission has exactly one transport attempt. A lost response or timeout may
mean that Runware accepted the task. The app records that outcome as uncertain;
check the matching task UUID in Runware before submitting again. Changing keys
or retrying submission automatically could duplicate billable work.

## Discovery and updates

**Verify connection** uses a one-result `modelSearch` request; it never submits
a generation. **Discover models** searches official checkpoints in pages of 100,
up to 500 entries within a shared deadline, and saves only image/video candidates.
This intentionally excludes the potentially very large community-model catalog.
Candidates remain unverified and do not appear automatically in the Studio.

Custom aliases can reuse an integrated AIR identifier and its adapter. A new AIR
identifier requires adding its public schema to the reviewed catalog; copying a
different model's controls is not enough to establish compatibility.

The source list and refresh script are `scripts/update-runware-catalog.mjs`.
It enumerates every live image/video entry with an AIR, checks the request and response task contracts, preserves validation
keywords and records a SHA-256 of each original task schema. A failed fetch or unsupported schema aborts the refresh before replacing the catalog, so transient failures cannot silently remove models. Output is sorted consistently. Run:

```sh
node scripts/update-runware-catalog.mjs
node scripts/verify-runware-models.mjs
npm run check
```

New fields also require translations and browser review. Refreshing schemas alone
does not establish production compatibility or prove paid generation works.

## Official references

- [Authentication and REST](https://runware.ai/docs/models-api/authentication)
- [Public model index](https://runware.ai/docs/models/index.json)
- [Per-model schemas and conditional rules](https://runware.ai/docs/models-api/model-schemas)
- [Model search](https://runware.ai/docs/models-api/model-search)
- [Asynchronous polling](https://runware.ai/docs/models-api/task-polling)
- [Errors and retry policy](https://runware.ai/docs/models-api/errors)
- [Task details](https://runware.ai/docs/models-api/task-details)
- [Media storage](https://runware.ai/docs/models-api/media-storage)

SVG renderer security: [librsvg resource rules](https://gnome.pages.gitlab.gnome.org/librsvg/Rsvg-2.0/class.Handle.html#security-and-locations-of-referenced-files) and [security limits](https://gnome.pages.gitlab.gnome.org/librsvg/devel-docs/security.html).
