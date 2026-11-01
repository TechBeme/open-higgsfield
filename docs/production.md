# Production: one protected operator workspace

Production requires HTTP Basic authentication, HTTPS, explicit persistent
storage/execution configuration and deliberate generation enablement. This is
one shared BYOK workspace: every credential holder can see, download, resume
and delete every task and use the configured provider accounts. There are no
individual accounts, ownership boundaries, application monetary budgets or
global request rate limits. Public multi-user service is unsupported.

Cloudinary outputs and uploaded provider references are **public by URL**. App
authentication does not make CDN originals private. Local generated outputs
remain behind the app credential, but reference uploads required by a provider
still use public Cloudinary delivery. See [storage](storage.md).

## Common configuration

Use platform secrets or a restricted environment file, never `NEXT_PUBLIC_*`,
logs or command-line arguments. Generate independent random operator/scheduler
secrets with your secret manager: 32-256 printable non-space ASCII characters.
Do not reuse personal passwords. Usernames allow letters, digits, `.`, `_`, `@`,
`-`. Replace the placeholders below:

```dotenv
APP_ORIGIN=https://studio.example.com
APP_ACCESS_USER=operator
APP_ACCESS_PASSWORD=<dedicated-random-secret-at-least-32-characters>
GENERATION_ENABLED=false
TASK_OBSERVATION_TIMEOUT_MS=86400000
```

The origin is exactly HTTPS without trailing slash or path. Mutations require
the exact browser Origin; missing/null origins and untrusted sibling sites are
denied. Forwarded host/IP headers do not grant authority. Basic credentials are
browser-cached; there is no reliable app logout. Use a dedicated browser profile
and rotate the shared secret when access changes.

Credential-free development is allowed only on loopback. `APP_ORIGIN`, when
set without credentials, must itself be a loopback origin, and each request URL
must also use loopback. `npm run dev` binds to `127.0.0.1`; Host/Origin
validation does not prove the actual socket is locally bound. For an authenticated
development environment on another HTTPS origin, configure both strong access
credentials and that exact origin. Never expose credential-free development
through a tunnel, reverse proxy or a public/all-interface bind.

Configure provider-side hard quotas/budgets where offered and billing alerts
before enabling generation. Alerts are not hard caps. Review model prices and
output counts. `GENERATION_ENABLED=false` stops **new** submissions while history,
downloads and existing task observation remain available. It is a kill switch,
not a money counter. Reload/redeploy after environment changes.

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
mount. PostgreSQL, even on one server, requires Cloudinary outputs under T4's
storage contract.

Startup validates configuration/store and starts the ten-second local observer.
A supervisor must restart the process after failure. Restart reloads due tasks
and never resubmits generation. Docker Compose uses `restart: unless-stopped`,
mounts `/app/data`, and publishes the HTTP port on loopback. Expose only the TLS
reverse proxy publicly. Configure production settings before starting Docker.

## Vercel and distributed execution

Set the common settings and:

```dotenv
DEPLOYMENT_PROFILE=distributed
TASK_WORKER_MODE=external
DATABASE_URL=<postgresql-or-neon-connection-string>
ASSET_STORAGE_MODE=cloudinary
ASSET_DELIVERY_MODE=public
CLOUDINARY_URL=<cloudinary-account-credentials>
CRON_SECRET=<different-random-secret-at-least-32-characters>
TASK_SCHEDULER_CONFIGURED=true
```

Cloudinary may instead use the three credential variables in `.env.example`.
Vercel rejects local file/asset/worker profiles. PostgreSQL is authoritative with
no file fallback or runtime DDL. Apply the explicit migration before starting.

Root `vercel.json` schedules `GET /api/internal/process-tasks` every minute.
**Vercel Pro or Enterprise is required**; Hobby supports daily cron only.
Vercel automatically sends `Authorization: Bearer $CRON_SECRET`. Basic cannot
run this endpoint, and the scheduler secret cannot access the workspace. The
endpoint rejects HEAD and query overrides, claims at most ten tasks and uses a
fifty-second work budget under `maxDuration=60`. Generation routes use `maxDuration=300`
and a 270-second request-entry budget.

`TASK_SCHEDULER_CONFIGURED=true` is an operator declaration, not proof of delivery.
Observe successful recurring invocations before enabling generation. Cron may
miss/duplicate/overlap calls and does not retry failures. Persisted schedules and
leases let later calls recover without paid resubmission. Next `after` or process
timers alone do not provide serverless recovery. If enabling Vercel Deployment
Protection, explicitly verify the cron still reaches its handler.

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
   `migrations/0001_durable_task_lifecycle.sql` with `psql -X -v ON_ERROR_STOP=1`.
   Supply the connection through a restricted PostgreSQL service/env file;
   never print it. Legacy file history is normalized by the new reader. Do not
   bulk-upload old media during startup.
3. Configure HTTPS/access and one supported profile. Missing configuration/schema
   stops startup with `ERR_STARTUP_CONFIGURATION_OR_STORAGE`; there is no open
   fallback. A production build does not need production credentials.
4. Verify unauthenticated page, list, generation, events, uploaded-media and
   download requests are denied, as are cross-origin/missing-Origin mutations.
   Public `GET /api/health` returns only `{"status":"alive"}`.
5. Authenticated `/api/ready` validates configuration and performs a current task
   store read. `scheduler_heartbeat:"unverified"` is deliberate. Verify recurring
   scheduler logs and demonstrate observation of an already accepted synthetic
   task after restart before claiming execution readiness.
6. Monitor `[task-scheduler] completed`/`deferred`, missing successful ticks over
   several expected intervals, old pending tasks, storage errors and recovery-
   required tasks. Logs contain only timings/counts/safe codes. Do not add raw
   upstream bodies, prompts, URLs or secrets. Monitoring is not provisioned here.
7. Confirm durable storage/public delivery and provider quotas, then explicitly
   enable `GENERATION_ENABLED=true` and reload. Paid smoke tests or real uploads
   require separate authorization; local checks do not perform them.

The UI fences repeated click/Enter while sending. Ambiguous HTTP 202, incomplete
storage, invalid responses and lost connections display a do-not-resubmit
warning and require explicit acknowledgement that task status was checked.
Acknowledgement sends nothing. Check history and provider records first: the
original request may already be running or charged.

Observation defaults to 24 hours (range 30 minutes to 7 days). Deadline/query failures
pause observation without asserting provider failure. After repairing the cause,
authenticated `POST /api/tasks/:id` or `/api/image-tasks/:id` with exact Origin and
empty body resumes only a paused task with a saved operation; it never repeats
generation. Unknown submissions without an operation need provider reconciliation.
Deleting a task fences worker writes but does not cancel provider generation or
automatically delete media. Tombstone/object retention needs an operator policy.

Rollback first disables generation and stops workers. Preserve the new writer/
storage contract, or restore matching app/data backups with reconciliation of
jobs accepted since backup. Do not restore public-access code without an
independent protected ingress, run old writers against migrated live state or
delete durable objects merely to roll back code.

## Official references and local evidence

- [Next.js authentication](https://nextjs.org/docs/app/guides/authentication) and
  [instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
- [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs),
  [cron plans](https://vercel.com/docs/cron-jobs/usage-and-pricing) and
  [function limits](https://vercel.com/docs/functions/limitations)
- [HTTP Basic](https://www.rfc-editor.org/rfc/rfc7617.txt) and
  [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [NGINX limits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html) and
  [Vercel WAF](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting)

Local synthetic tests do not establish production TLS/cron delivery, disk mount
durability, Cloudinary availability/privacy or configured provider quotas.
