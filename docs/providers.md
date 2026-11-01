# Providers and models

Only the provider selected for a generation needs to be configured. All credentials are read on the server.

## Freepik

```dotenv
FREEPIK_API_KEY=
```

Open-Higgsfield includes Freepik image families such as Flux, Seedream and Z-Image, plus video families such as Kling, Runway, Wan, MiniMax, Seedance, PixVerse, LTX and OmniHuman.

## Google AI Studio

```dotenv
GEMINI_API_KEY=
```

`GOOGLE_AI_API_KEY` is also accepted as a fallback. The integration supports Gemini image generation and Veo video generation.

AI Studio Veo uses the model's audio behavior. Its installed SDK does not accept
the Vertex-only `generateAudio` control, so no audio switch is exposed there.

## Google Vertex AI

```dotenv
GOOGLE_CLOUD_PROJECT=your-project-id
GOOGLE_CLOUD_LOCATION=global
```

Authentication options:

1. Application Default Credentials.
2. A local service account file through `GOOGLE_APPLICATION_CREDENTIALS`.
3. Inline JSON through `GOOGLE_SERVICE_ACCOUNT_JSON` or `GOOGLE_CLOUD_CREDENTIALS`.

Service account files and local credential files are ignored by Git.

## Vercel AI Gateway

```dotenv
AI_GATEWAY_API_KEY=
```

The current catalog includes Google, Black Forest Labs, Recraft, OpenAI, Alibaba Wan and KlingAI models exposed through the gateway.

## ToAPIs

```dotenv
TOAPIS_API_KEY=
# Optional; only this exact origin is accepted, without /v1:
# TOAPIS_BASE_URL=https://toapis.com
```

Credentials stay on the server. ToAPIs is additive and needs no provider-specific
database migration; production task persistence still requires the separate task
lifecycle migration.

| Models | Enabled controls |
| --- | --- |
| `gpt-image-2`, `gpt-image-2.5-flare` | Text-to-image, one result, 16:9/1:1/9:16, 1K/2K/4K. No image editing or reference inputs. Flare uses fixed high quality. |
| `seedance-2`, `seedance-2-fast`, `seedance-2-mini` | One required first frame, four seconds, 480p/720p, 16:9/1:1/9:16, no generated audio. |
| `seedance-2-5` | One required first frame, four seconds, 480p/720p, **adaptive** ratio determined by the input frame, no generated audio. |

First-frame URLs must be public HTTPS without embedded credentials and at most
2048 bytes. Output URLs are temporary; the application materializes outputs into
its configured asset storage. The subset deliberately excludes VIP image models,
additional references, editing, extension, webhook callbacks and audio inputs.

Current official contracts: [image generation](https://docs.toapis.com/docs/en/api-reference/images/gpt-image-2/generation),
[Flare](https://docs.toapis.com/docs/en/api-reference/images/gpt-image-2.5/generation),
[Seedance 2](https://docs.toapis.com/docs/en/api-reference/videos/seedance-2/generation),
[Seedance 2.5](https://docs.toapis.com/docs/en/api-reference/videos/seedance-2-5/generation),
[image status](https://docs.toapis.com/docs/en/api-reference/tasks/image-status),
[video status](https://docs.toapis.com/docs/en/api-reference/tasks/video-status).

## Submission and recovery behavior

Each provider submission is attempted once. Native Google retries are disabled;
Google interactions and every Gateway generation method have their separate
retry engines disabled as well. A lost response, timeout, cancellation after
dispatch, server failure or malformed acceptance can mean the provider accepted
a paid job. The application keeps that task for investigation and never repeats
its generation automatically. A caller cancellation does not cancel or refund
an upstream job.

Provider requests inherit the caller's cancellation and have a maximum of 180
seconds for submission or 20 seconds for status observation. These do not reset
the route's overall budget. T2's task scheduler owns query retries, jitter and
Retry-After; HTTP errors do not mean the provider job failed. Most observation
requests are GET, but Google Vertex and Vercel Gateway use documented read-only
status POSTs. Those may be retried without calling generation submission again.
Google's authenticated file download has a 64 MiB limit and inherits the query
signal. General asset/input limits are documented with storage configuration.

Only an explicit provider task failure becomes a confirmed failed generation.
Malformed operations/results pause observation for repair. The observation
deadline (24 hours by default) is separate from a transport timeout and preserves
the operation. ToAPIs can spend 20 minutes preparing reference media before
generation starts.

Google stores only the validated operation name needed to query again. Completed
video bytes and upstream metadata stay out of the task operation, including when
older saved operations are read. Generated media goes through the asset flow.

For a ToAPIs video with an uncertain submission, the local task ID was sent as
`client_business_id`. An authorized operator can investigate with
`GET https://toapis.com/v1/videos/generations/{local_task_id}` using the server-side
key, then reconcile the returned upstream task and local reservation. Treat that
field as a lookup identifier; no upstream deduplication guarantee was established.
There is no automatic POST replay or reconciliation endpoint in this release.
Image requests omit that undocumented field and need provider-side investigation.

To disable new ToAPIs selections, remove its catalog entries while retaining the
provider adapter and credential for existing tasks. Removing those with pending
jobs pauses recovery and requires operator reconciliation. Do not run an old
whole-snapshot task writer against the migrated task schema.

Freepik's current official documentation redirects to Magnific branding and a
new origin/header. This release preserves the existing Freepik API origin,
header and environment variable; account migration and live compatibility have
not been verified. Provider tests use synthetic requests and do not establish
live account access, output quality, prices, refunds or settled charges.

## Reference media uploads

Some providers require a public URL for asynchronous image/video inputs. Open-Higgsfield uses Cloudinary for this handoff.

```dotenv
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
```

You can alternatively configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` separately.

## Adding a model

If an existing provider already supports the model's API shape:

1. Add its capability entry to `src/models/capabilities/image.ts`, `video.ts` or `external.ts`.
2. Set `provider`, `provider_model_id` and `provider_mode` when needed.
3. Define every supported control and media slot.
4. Verify the model appears in `/api/image-models` or `/api/models`.
5. Run `npm run check`.

Freepik models that need a new payload shape also require a model-family adapter in `src/models/adapters/`.

## Adding a provider

Implement the `GenerationProvider` interface from `src/providers/types.ts`, register it in `src/providers/registry.ts`, and add its credential documentation to `.env.example`.
