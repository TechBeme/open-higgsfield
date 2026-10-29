# Optional ToAPIs image/video provider

Set `TOAPIS_API_KEY` in the existing server environment. Never use a NEXT_PUBLIC variable. `TOAPIS_BASE_URL=https://toapis.com` is the HTTPS origin, without `/v1`. Credentials stay server-side. Restart the application after configuring its environment.

Select a ToAPIs model in the existing image/video model picker. Image generation supports gpt-image-2 and gpt-image-2.5-flare, one output, 1K/2K/4K, and the aspect ratios listed in capabilities. Video supports seedance-2, seedance-2-fast, seedance-2-mini and seedance-2-5: one first-frame URL, 4 seconds, 480p/720p, audio disabled. These are deliberately bounded capabilities; editing, multiple reference images, transparent output and other video durations are not advertised.

Each create call submits once. The persisted provider operation contains the upstream task ID, model, media type and origin, never the Key. Polling and restart recovery only query the original task. Unknown submission outcomes must be reconciled rather than automatically resubmitted. Existing task history and asset download remain owned by the host application.

Validation on 2026-10-29: contract tests cover payloads, persisted-operation recovery, GET-only polling, expiry/failure mapping, one-shot submission, secret-safe errors and parameter rejection. The existing application HTTP routes completed one real image and one real video, downloaded their results, and resumed the same video operation after a server restart. Browser UI clicks, Cloudinary file upload, editing and other model configurations were not accepted by this test. The video probe used an already-hosted first-frame URL.

Run `npm run check` (provider contracts, lint, typecheck, production build). Network-restricted deployments should configure their own supported outbound proxy; no proxy is embedded here.

Pricing is account-specific: query https://docs.toapis.com/docs/en/api-reference/account/pricing before generating. A quotation is not a final charge. Task `billing.status=settled` is used for confirmed charges; token rates and observed dollars per second are distinct. This provider does not change the host application's wallet or add a billing UI.
