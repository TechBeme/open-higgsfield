# Production: one personal workspace

The application has no built-in login or password protection. Each deployment
is one shared personal workspace: anyone who can access its URL can view its
history and settings and, outside demo mode, change settings and use configured
provider accounts. There are no individual accounts or ownership boundaries.
Production uses HTTPS, explicit persistent storage/execution configuration and
deliberate generation enablement.

## Public demo

To publish a read-only interface demo, set `APP_DEMO_MODE=true`,
`GENERATION_ENABLED=false`, and `APP_ORIGIN` to its exact HTTPS origin. All
workspace write requests are rejected before parsing inputs or contacting
providers; visitors can browse the Studio and provider settings but cannot save
keys, upload, generate or change shared data. Existing history and provider
metadata remain visible, so use a separate empty database and no provider
credentials for the demo. The storage/execution configuration below still
applies. Redeploy after changing the environment. Personal functional deployments
leave demo mode off; they also have no application login.

Vercel Blob and S3 default to private originals with expiring, scoped links for
browsers and AI providers. The app's media routes issue those links without a
login. Legacy Cloudinary originals remain public by URL. See [storage](storage.md).

## Common configuration

Use platform secrets or a restricted environment file, never `NEXT_PUBLIC_*`,
logs or command-line arguments. Replace the placeholders below:

```dotenv
APP_ORIGIN=https://studio.example.com
GENERATION_ENABLED=false
TASK_OBSERVATION_TIMEOUT_MS=86400000
# Required before saving connections from /<locale>/settings.
PROVIDER_CONFIG_ENCRYPTION_KEY=<independent-random-secret-at-least-32-characters>
```

The origin is exactly HTTPS without trailing slash or path. Mutations require
the exact browser Origin; missing/null origins and untrusted sibling sites are
denied. Forwarded host/IP headers do not grant authority. Local development can
use an HTTP loopback origin. `npm run dev` binds to `127.0.0.1` by default.

Configure provider-side hard quotas/budgets where offered and billing alerts
before enabling generation. Alerts are not hard caps. Review model prices and
output counts. `GENERATION_ENABLED=false` stops new submissions, including queued
tasks that have not reached their provider, while history, downloads and existing
task observation remain available. It is a kill switch, not a money counter.
Reload/redeploy after environment changes.

## Persistent single process

```dotenv
DEPLOYMENT_PROFILE=single-process
TASK_WORKER_MODE=local
ASSET_STORAGE_MODE=local
OPEN_HIGGSFIELD_STORAGE_DIR=/app/data
```

Leave `DATABASE_URL` unset for local task history. Mount a persistent disk at
the absolute path and run exactly one Node process: no PM2 cluster, multiple
containers, replicas or ephemeral volume. Configuration cannot prove a durable
mount. PostgreSQL, even on one server, requires durable object storage (Blob, S3 or
legacy Cloudinary).

Startup validates configuration/store and starts the ten-second local observer.
A supervisor must restart the process after failure. Restart reloads due tasks
and never resubmits generation. Docker Compose uses `restart: unless-stopped`,
mounts `/app/data`, and publishes the HTTP port on loopback. Expose only the TLS
reverse proxy publicly. Configure production settings before starting Docker.

## Vercel and distributed execution

Set the common settings and:

```dotenv
DEPLOYMENT_PROFILE=distributed
TASK_WORKER_MODE=workflow
DATABASE_URL=<postgresql-or-neon-connection-string>
ASSET_STORAGE_MODE=vercel-blob
ASSET_DELIVERY_MODE=private
# Vercel supplies BLOB_STORE_ID and VERCEL_OIDC_TOKEN for a connected store.
# BLOB_READ_WRITE_TOKEN=<static-token-for-local-or-non-Vercel-hosts>
```

S3 is also supported; see [media storage](storage.md) for settings and credentials.
Vercel rejects local file/asset/worker profiles. PostgreSQL is authoritative with
no file fallback or runtime DDL. Apply the explicit migration before starting.

Enable Fluid compute and access to System Environment Variables in the Vercel
project settings; the SDK needs `VERCEL_DEPLOYMENT_ID` to select its Vercel World.
The application rejects non-Vercel Workflow targets in production. Next config
uses the official `withWorkflow` plugin. No minute Cron, GitHub scheduler,
`CRON_SECRET` or `TASK_SCHEDULER_CONFIGURED` is required for this profile.

The request saves an inactive queued task, waits for durable Workflow admission,
then activates it and returns HTTP 202. The Workflow submits once, observes the
saved operation and stores outputs after the browser closes. SQL leases and
revisions fence duplicate delivery. Unknown submission outcomes are never
resubmitted automatically. Inputs use stable media routes; signing happens just
before submission. Workflow event arguments/results exclude prompts and secrets.
See [background execution](background-execution.md) for deadlines, retries,
recovery and costs. Free allowances are finite and AI credits remain separate.

The SDK's generated `/.well-known/workflow/*` queue handlers validate their own
delivery credentials. Preserve this integration and verify delivery with any
Deployment Protection settings. `/api/ready` deliberately reports
`workflow_execution: "unverified"`; validate an actual synthetic run on Vercel.

### Optional external workers on another host

Keep `TASK_WORKER_MODE=external`, a random `CRON_SECRET` of 32-256 printable
non-space ASCII characters and
`TASK_SCHEDULER_CONFIGURED=true` only when installing a separate recurring
trigger. `/api/internal/process-tasks` accepts the Bearer scheduler credential. It rejects
HEAD/query overrides, claims at most ten tasks and has a fifty-second work budget
under `maxDuration=60`. Generation routes retain `maxDuration=300` and a
270-second entry budget. Workflow steps have a bounded 240-second work budget.
The declaration does not prove recurring delivery. Timers/Next `after` alone do
not provide durable serverless recovery. The repository does not install a Cron.

On another platform, a systemd timer can invoke the same HTTPS endpoint:

```ini
# open-higgsfield-poll.service
[Service]
Type=oneshot
ExecStart=/usr/bin/curl --config /etc/open-higgsfield/cron.curl
TimeoutStartSec=60
```

```ini
# open-higgsfield-poll.timer
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
Persistent=true
[Install]
WantedBy=timers.target
```

Keep the curl config readable only by the service identity (mode 0600):

```text
url = "https://studio.example.com/api/internal/process-tasks"
header = "Authorization: Bearer <scheduler-secret>"
fail-with-body
silent
show-error
max-time = 55
```

Do not use retry flags, follow redirects or print authorization. This example
does not install a timer or claim one is running. It needs the external-worker
profile and a separately supervised, available application.

## Ingress and request limits

Direct generation attachments and fields together must fit under **4 MiB**,
including multipart framing. Actual streamed bytes are counted, at most sixteen
files and 128 fields are allowed, each string field is bounded to 64 KiB, and body
reads expire after thirty seconds. Use supported public HTTPS reference URLs for
larger videos. Remote/generated-media bounds are separate. There is no direct
browser-to-object-store upload flow. Gallery JSON is limited to 16 KiB; task
resume/delete accepts empty bodies only.

Configure ingress rate controls separately. NGINX can define a global zone in
its `http` block, avoiding dependence on claimed client IP headers:

```nginx
limit_req_zone $server_name zone=workspace_generation:1m rate=6r/m;
```

In the HTTPS server:

```nginx
location ~ ^/api/generate(-image)?$ {
    limit_req zone=workspace_generation burst=2 nodelay;
    limit_req_status 429;
    client_max_body_size 4m;
    client_body_timeout 30s;
    proxy_read_timeout 310s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_pass http://127.0.0.1:3000;
}
```

Add actual TLS certificates, normal application proxy locations and SSE
buffering settings. Vercel operators can configure documented WAF rate rules.
Neither example is automatically installed or establishes a monetary limit.
Use platform ingress controls against credential guessing and availability abuse.

## Activation, monitoring and recovery

1. Back up task/media data and stop every old web/worker writer; old writers
   ignore revisions/tombstones. Keep generation disabled.
2. After separate production authorization, apply
   `migrations/0001_durable_task_lifecycle.sql`,
   `migrations/0002_provider_runtime_catalog.sql` and
   `migrations/0003_workflow_queue.sql`, in that order when missing, with
   `psql -X -v ON_ERROR_STOP=1`.
   Supply the connection through a restricted PostgreSQL service/env file;
   never print it. Legacy file history is normalized by the new reader. Do not
   bulk-upload old media during startup. Task schema version is now 3; do not
   reapply older migration 0001 after the forward migration.
3. Configure HTTPS and one supported profile. Missing configuration/schema
   stops startup with `ERR_STARTUP_CONFIGURATION_OR_STORAGE`; there is no open
   fallback. A production build does not need runtime secrets.
4. Verify pages, lists, events and media routes load without login. Verify
   cross-origin/missing-Origin mutations are denied. In demo mode, all workspace
   writes must be denied, including generation and provider configuration.
   Public `GET /api/health` returns only `{"status":"alive"}`.
5. `/api/ready` validates configuration and performs a current task
   store read. Workflow mode reports `scheduler_heartbeat:"not_applicable"` and
   `workflow_execution:"unverified"`. Verify a synthetic Workflow on the target
   deployment. For external mode, verify recurring scheduler delivery instead.
   After switching profiles, POST an empty body to
   `/api/internal/reconcile-workflows` with exact Origin to arm observers for
   previously accepted tasks (at most 20 per call; follow `nextCursor` via
   `?after=<nextCursor>`). Duplicate runs are safe for
   provider spending but consume extra Workflow events.
6. Monitor Workflow runs/failures and usage (or `[task-scheduler]` in external
   mode), old pending tasks, storage errors and recovery-
   required tasks. Logs contain only timings/counts/safe codes. Do not add raw
   upstream bodies, prompts, URLs or secrets. Monitoring is not provisioned here.
7. Confirm durable storage and the chosen delivery policy and provider quotas, then explicitly
   enable `GENERATION_ENABLED=true` and reload. Paid smoke tests or real uploads
   require separate authorization; local checks do not perform them.

The UI fences repeated click/Enter while sending. Ambiguous HTTP 202, incomplete
storage, invalid responses and lost connections display a do-not-resubmit
warning and require explicit acknowledgement that task status was checked.
Acknowledgement sends nothing. Check history and provider records first: the
original request may already be running or charged.

Observation defaults to 24 hours (range 30 minutes to 7 days). Deadline/query failures
pause observation without asserting provider failure. After repairing the cause,
`POST /api/tasks/:id` or `/api/image-tasks/:id` with exact Origin and
empty body resumes only a paused task with a saved operation; it never repeats
generation. Unknown submissions without an operation need provider reconciliation.
Deleting a task fences worker writes but does not cancel provider generation or
automatically delete media. Tombstone/object retention needs an operator policy.

Rollback first disables generation and stops workers. Preserve the new writer/
storage contract, or restore matching app/data backups with reconciliation of
jobs accepted since backup. Do not run old writers against migrated live state
or delete durable objects merely to roll back code.

## Official references and local evidence

- [Next.js instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
- [Workflow integration](https://workflow-sdk.dev/docs/getting-started/next),
  [deployment](https://workflow-sdk.dev/docs/deploying),
  [pricing](https://vercel.com/docs/workflows/pricing) and
  [function limits](https://vercel.com/docs/functions/limitations)
- [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [NGINX limits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html) and
  [Vercel WAF](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)

Local synthetic tests do not establish production TLS/Workflow delivery, disk mount
durability, real Blob/S3/Cloudinary delivery or configured provider quotas.
