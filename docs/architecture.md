# Architecture

Open-Higgsfield is a modular Next.js App Router application with React Server Components at the route boundary and client components where the product needs browser state. TypeScript runs in strict mode. Tailwind CSS v4 provides the styling layer. The local `src/components/ui/` library follows shadcn conventions and uses Base UI primitives with class-variance-authority; product components live under feature modules.

The application is a single-user, self-hosted workspace. It does not implement a multi-tenant account domain or a browser-to-provider architecture. Provider credentials stay on the server and are selected from the encrypted runtime configuration.

## Source layout

```text
src/
  app/                 Next.js routes, metadata and API route handlers
  features/
    studio/            command bar, model controls and client submission helpers
    providers/         provider settings, connections and model preferences
    tasks/             result feed, previews and task history hooks
    catalog/           filtered runtime catalog hooks
  components/layout/   shared workspace navigation
  components/ui/       shadcn-style shared primitives
  models/              canonical inputs, capability types and shared validation
  providers/           provider metadata and shared contracts
  types/               task and media contracts
  lib/                 browser-safe shared utilities
  server/
    catalog/           built-in capabilities, runtime filtering and discovery
    config/            encrypted provider configuration and deployment settings
    generation/        submission handlers, validation and orchestration
    providers/         provider SDK adapters and transport
    tasks/             task persistence, lifecycle and polling
    media/             bounded uploads, downloads and asset storage
    security/          workspace and scheduler access control
    http/              request size and content handling
```

The route layer composes features; it does not contain provider request details. The active Studio is `features/studio` plus `features/tasks`. The old split `ImageStudio`/`VideoStudio` implementation was removed after the active route was consolidated around the capability-driven command bar.

All server modules declare `import "server-only"`. Client features share types and pure helpers, never server implementations or provider SDKs. The localized `app/[locale]/layout.tsx` is the root layout and owns the document, fonts and shared navigation; the next-intl proxy redirects `/` to a supported locale.

The interface supports `en`, `pt-BR` (default) and `es`, defined in
`src/i18n/locales.ts`. The language menu uses next-intl navigation to preserve the
current path and query and remember the selection in the locale cookie. UI copy,
validation, accessibility labels, metadata and install manifests use locale
dictionaries. Provider documentation uses deduplicated content keys and literal
translations so JSON examples cannot be interpreted as ICU messages. Only display
labels and schema documentation are localized: model IDs, enum values, validation
rules, prompts and user-defined content remain canonical. `scripts/verify-i18n.mjs`
checks dictionary parity, ICU arguments, complete built-in catalog coverage and
schema invariants; update all three dictionaries when adding catalog content.

## Layers

### 1. Model capabilities

`src/server/catalog/` holds built-in and runtime capabilities. Their shared types and UI helpers live in `src/models/capabilities/`. A capability describes:

- provider and upstream model ID;
- image or video mode;
- duration, aspect ratio and resolution;
- negative prompts, CFG, seed, style and custom fields;
- required and optional media slots.

The UI renders controls directly from these capabilities.

### 2. Canonical input

`src/models/canonical.ts` defines normalized generation parameters and media inputs. Route handlers convert form data into this format before any provider code runs.

### 3. Provider registry

`src/server/providers/registry.ts` maps a provider ID to a `GenerationProvider` implementation. The common contract supports synchronous generated assets, asynchronous operations, normalized polling states and serializable provider state.

### 4. Magnific contracts

Magnific request schemas live in `src/server/catalog/magnific.ts`. Its provider validates parameters and uses only the current Magnific origin and authentication header.

### 5. Tasks and generated assets

`src/server/generation/service.ts` creates normalized tasks. `src/server/tasks/poller.ts` follows asynchronous jobs. `src/server/media/generated-assets.ts` materializes images and videos for the result feed.

## Request lifecycle

1. The user selects a model and fills the capability-driven controls.
2. The API route delegates to the server generation handler, which validates the form and creates canonical parameters.
3. The registry resolves the provider and upstream model ID.
4. The provider returns generated assets or an asynchronous operation.
5. Open-Higgsfield normalizes status updates and attaches completed assets to the task.
6. The result feed receives updates and exposes reuse/download actions.

## Client data flow

SWR owns browser reads for runtime model catalogs and task history. The Studio never imports a provider SDK. It reads the filtered runtime catalog from `/api/image-models` or `/api/models`, and its controls are derived from the selected capability contract. Mutations invalidate the relevant SWR keys so disabled connections and model preferences do not remain visible after navigation.

## Storage

PostgreSQL/Neon stores task metadata and durable media references, not new image bytes. Database/serverless deployments require Cloudinary storage with explicit public-delivery acknowledgement; its CDN originals remain public even when the studio is protected. Local mode supports one process with a persistent disk at `OPEN_HIGGSFIELD_STORAGE_DIR`. Outputs use content-addressed names so stale workers cannot replace newer media. Legacy inline records remain readable within deployment payload limits. See [storage](storage.md) for configuration, limits and migration.

## Extension points

- Add provider adapters in `src/server/providers/` and register them in its registry.
- Add provider metadata in `src/providers/definitions.ts`; saved connections are resolved by `src/server/config/provider-store.ts`.
- Add model definitions in `src/server/catalog/`.
- Add Magnific schema contracts in `src/server/catalog/magnific.ts`.
- Replace local task/file persistence behind `src/server/tasks/store.ts` and `src/server/media/storage.ts`.

## Runtime catalog and single-user provider configuration

Provider definitions, saved connections and model capabilities are separate
runtime concerns. The settings screen writes encrypted connection records and
model preferences; `/api/image-models` and `/api/models` expose only enabled
models from providers with at least one enabled configured connection. The full
reviewed catalog remains available to settings so an operator can configure a
provider before using its models in the Studio.

Every generation task records the selected provider connection ID and a copy of
the capability contract used at submission. Polling uses the persisted provider
and connection, so disabling a model later does not change an existing task.

Saved connections take precedence over environment credentials. Disabling every
saved key prevents new submissions; corrupt configuration never silently falls
back to an environment key. In-progress tasks keep their original connection ID,
including `env:<provider>`. A disabled or removed saved connection cannot be used
to poll until its credentials are available again.

Local configuration writes are atomic and serialized within the supported single
process. PostgreSQL writes compare the previously read document inside the upsert;
conflicts reapply the mutation to the latest document with a bounded retry. This
prevents independent workers from overwriting unrelated key or model changes.

Discovery is intentionally conservative. A provider model-list response is
stored as unverified metadata; it does not create an executable model until a
reviewed capability contract exists. Custom contracts are saved disabled and
must use a known adapter. No custom endpoint or authentication header is
accepted from the settings UI.

## Verification

`npm run check` runs the dependency audit, lint, strict typecheck, regression suite,
production build and browser tests. `scripts/verify-architecture.mjs` checks client dependency
graphs, server-only declarations, shared contract boundaries and product component
reachability. Provider tests execute the real adapters with mocked upstream APIs;
they do not spend credits or prove live provider availability. PostgreSQL
integration tests require an explicitly configured disposable test database and
`REQUIRE_POSTGRES_TESTS=1`; see [production](production.md) for the variables.

Install the test browsers with `npx playwright install --with-deps chromium firefox webkit`
before running `npm run build` and `npm run test:e2e`. Node 22 and OpenSSL must be available. The suite
starts its own authenticated HTTPS workspace on loopback ports 3110 and 3111;
those ports must be free. It uses temporary storage, synthetic credentials and
disabled generation, and removes its data on exit. Local provider keys, history
and database settings are overridden for this process. Do not point these tests
at a deployed workspace.

The browser runner tests the production build by default, following Next.js's
recommendation; rebuild after source changes. `npm run check` and CI build before
running the suite. For development diagnostics, use
`E2E_PRODUCTION=0 npm run test:e2e`, which uses a separate `.next-e2e` directory.
Chromium, Firefox, WebKit and mobile Chromium cover
English, Portuguese and Spanish, hydration/F5, provider connections, authenticated
logos, model selection, attachment limits, failed-request recovery, task history,
keyboard focus and automated accessibility checks. External generation and uploads
are mocked. Reports and failure traces stay in ignored `playwright-report/` and
`test-results/` directories. Automated checks do not replace visual inspection of
the rendered pages or validate paid generation with a real provider account.

Next.js 16.4.3's development-only RSC profiler can report a negative timestamp when
the localized catch-all calls `notFound()`. The issue also remains in the official
16.4.4 bundle ([React issue 37561](https://github.com/react/react/issues/37561)).
The application retains the documented not-found boundary and does not suppress
this error. Development diagnostics can therefore fail on this upstream issue;
production tests still assert the localized 404, noindex and absence of browser errors.

## Official references

- [Next.js project structure](https://nextjs.org/docs/app/getting-started/project-structure)
- [Next.js server and client components](https://nextjs.org/docs/app/getting-started/server-and-client-components)
- [Next.js root layout](https://nextjs.org/docs/app/api-reference/file-conventions/layout)
- [shadcn with Next.js](https://ui.shadcn.com/docs/installation/next)
- [PostgreSQL INSERT and conflict handling](https://www.postgresql.org/docs/16/sql-insert.html)
