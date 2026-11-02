# Providers and models

Only the provider selected for a generation needs to be configured. All credentials are read on the server.

## Magnific

```dotenv
MAGNIFIC_API_KEY=
```

Current schema-backed image/video models use only `https://api.magnific.com` and `x-magnific-api-key`. The former Freepik provider, credentials and model catalog are no longer supported. Saved outputs remain readable; unfinished legacy jobs cannot be polled through Magnific.

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

Model synchronization uses the public `GET https://ai-gateway.vercel.sh/v1/models` endpoint and requires no key. Generation still requires a configured connection. Google AI Studio model synchronization requires an enabled API key. Reloading the page only reads the saved catalog; it does not contact providers.

## ToAPIs

```dotenv
TOAPIS_API_KEY=
# Optional; only this exact origin is accepted, without /v1:
# TOAPIS_BASE_URL=https://toapis.com
```

Credentials stay on the server. ToAPIs is additive and needs no provider-specific
database migration; production task persistence still requires the separate task
lifecycle migration.

The current registry covers the documented image/video/action contracts, including
GPT Image 2.5, Seedance 2/2.5, Kling, Veo, Wan, Vidu, Grok, Sora, Gemini
Omni and Midjourney actions. The complete model and parameter matrix is maintained
in [`docs/toapis-models.md`](toapis-models.md) and verified by
`scripts/verify-toapis-models.mjs`.

First-frame URLs must be public HTTPS without embedded credentials and at most
2048 bytes. Output URLs are temporary; the application materializes outputs into
its configured asset storage. Webhook, callback and credential fields remain
server-owned even where the upstream documentation exposes them.

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

Provider tests use synthetic requests and do not establish live account access,
output quality, prices, refunds or settled charges.

## Reference media uploads

Some providers require a public URL for asynchronous image/video inputs. Open-Higgsfield uses Cloudinary for this handoff.

The multipart request guard is 4 MiB. References larger than that must be
provided through a validated public HTTPS URL; the provider-specific byte limits
shown in each catalog do not raise this application transport ceiling.

```dotenv
CLOUDINARY_URL=cloudinary://api_key:api_secret@cloud_name
```

You can alternatively configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` separately.

## Adding a model

If an existing provider already supports the model's API shape:

1. Add its capability entry to `src/server/catalog/image.ts`, `video.ts` or `external.ts`.
2. Set `provider`, `provider_model_id` and `provider_mode` when needed.
3. Define every supported control and media slot.
4. Verify the model appears in `/api/image-models` or `/api/models`.
5. Run `npm run check`.

Magnific models require a reviewed schema contract in `src/server/catalog/magnific.ts`.

## Adding a provider

Implement the `GenerationProvider` interface from `src/providers/types.ts`, register it in `src/server/providers/registry.ts`, and add its credential documentation to `.env.example`.

## Magnific current catalog

The current official Freepik documentation redirects to Magnific. New image/video contracts use `https://api.magnific.com` and `x-magnific-api-key`; set `MAGNIFIC_API_KEY`. The legacy Freepik API is not used. The generated catalog is sourced from the official OpenAPI document at `https://storage.googleapis.com/fc-freepik-pro-rev1-eu-api-specs/magnific-api-v1-openapi.yaml` (refreshed 2026-11-01). The application excludes non-image/video products such as training, classifier, prompt utilities, music and speech.
## Runtime provider configuration

Each deployment has one operator configuration. Open `/en/settings` (or the
configured locale) to add one or more connections for a provider, choose a
priority, enable or disable models, and save a custom capability contract.
Connections are stored server-side. Set `PROVIDER_CONFIG_ENCRYPTION_KEY` to a
stable 32-character-or-longer secret before saving a connection; the browser
never receives the API secret. Existing `.env` keys remain a read-only fallback.
When PostgreSQL is enabled, apply `migrations/0002_provider_runtime_catalog.sql`
before opening the settings page. File mode uses the private
`provider-runtime-config.json` file under the configured storage directory.
Multiple enabled connections at the lowest priority are selected round-robin;
an explicitly unhealthy connection is skipped when another healthy connection
exists. The connection ID is pinned to the task for polling and recovery.

The model catalog API exposes only enabled models to the generation UI. Sync
stores provider model IDs as unverified candidates; it does not guess their
media capabilities or turn them on. Custom models are saved disabled and
marked unverified. The provider adapter still owns the upstream endpoint,
authentication and parameter translation, so a custom catalog entry cannot
turn the application into an arbitrary proxy.
