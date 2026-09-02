# Deployment

## Security before deployment

A public deployment backed by paid API keys can generate real provider costs. Before enabling generation for anonymous visitors:

- add authentication;
- enforce rate limits outside the process;
- set provider and billing spend limits;
- restrict allowed origins where supported;
- monitor generation volume and failures;
- rotate any credential that may have been exposed.

Do not expose provider keys through `NEXT_PUBLIC_*` variables.

## Vercel

1. Import the GitHub repository into Vercel.
2. Add only the credentials for the providers you want enabled.
3. Add Cloudinary credentials for reference media workflows.
4. Point `open-higgsfield.techbe.me` to the deployment.
5. Enable deployment protection while validating real provider calls.

Vercel functions use `/tmp/open-higgsfield` automatically. That filesystem and in-memory task state are ephemeral. The UI deploys normally, but reliable asynchronous generation needs durable task storage and a queue/worker or scheduled polling strategy.

## Docker

Docker is the recommended full local/self-hosted deployment because task history and generated files can stay on a persistent volume.

```bash
cp .env.example .env.local
docker compose up --build -d
```

The container exposes port `3000`, stores runtime data under `/app/data`, and provides `/api/health` for health checks.

## Node.js

```bash
npm ci
npm run build
OPEN_HIGGSFIELD_STORAGE_DIR=/var/lib/open-higgsfield npm start
```

Ensure the process user can write to `OPEN_HIGGSFIELD_STORAGE_DIR`. Put a TLS reverse proxy in front of the app and configure upload/body limits appropriate for media generation.

## Production persistence

The current persistence modules are intentionally small and easy to replace:

- `src/lib/task-store.ts` for task state;
- `src/lib/upload.ts` for inputs and generated files;
- `src/lib/poller.ts` for asynchronous provider operations.

For a horizontally scaled deployment, use shared object storage, a database and a queue/worker instead of local files and background timers.
