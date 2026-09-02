# Architecture

Open-Higgsfield separates product behavior from provider-specific API details. The command bar never needs to know how Freepik, Google or Vercel structures a request.

## Layers

### 1. Model capabilities

`src/models/capabilities/` is the source of truth for what a model supports:

- provider and upstream model ID;
- image or video mode;
- duration, aspect ratio and resolution;
- negative prompts, CFG, seed, style and custom fields;
- required and optional media slots.

The UI renders controls directly from these capabilities.

### 2. Canonical input

`src/models/canonical.ts` defines normalized generation parameters and media inputs. Route handlers convert form data into this format before any provider code runs.

### 3. Provider registry

`src/providers/registry.ts` maps a provider ID to a `GenerationProvider` implementation. The common contract supports synchronous generated assets, asynchronous operations, normalized polling states and serializable provider state.

### 4. Freepik adapters

Freepik has model-family-specific payload and endpoint differences. Those remain isolated in `src/models/adapters/`, preserving provider behavior without leaking it into the UI.

### 5. Tasks and generated assets

`src/lib/generation-service.ts` creates normalized tasks. `src/lib/poller.ts` follows asynchronous jobs. `src/lib/generated-assets.ts` materializes images and videos for the result feed.

## Request lifecycle

1. The user selects a model and fills the capability-driven controls.
2. A route handler validates the form and creates canonical parameters.
3. The registry resolves the provider and upstream model ID.
4. The provider returns generated assets or an asynchronous operation.
5. Open-Higgsfield normalizes status updates and attaches completed assets to the task.
6. The result feed receives updates and exposes reuse/download actions.

## Storage

When `DATABASE_URL` is configured, task history and generated images are persisted in PostgreSQL/Neon. Local development falls back to disk, and `OPEN_HIGGSFIELD_STORAGE_DIR` changes that storage root. Temporary uploads and generated videos still use the filesystem; Vercel defaults to ephemeral `/tmp/open-higgsfield` for those files.

## Extension points

- Add providers in `src/providers/`.
- Add model definitions in `src/models/capabilities/`.
- Add Freepik model-family translations in `src/models/adapters/`.
- Replace local task/file persistence behind `src/lib/task-store.ts` and `src/lib/upload.ts`.
