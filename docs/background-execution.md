# Background execution with Vercel Workflows

Official documentation reviewed November 4, 2026. The Vercel adapter is implemented
with `workflow` 5.3.0. PostgreSQL remains the authority for task state; Vercel
Workflows runs submission, observation and durable media storage after acceptance.
The browser can close after HTTP 202 without stopping that work.

## Execution and paid-request safety

1. Validate the model, parameters and input, and save an **inactive queued task**
   with stable application media references. No paid request has been sent.
2. Await durable Workflow admission. Only the task ID, revision threshold and
   timing bounds enter Workflow arguments; keys, prompts and media stay outside
   the event payload. Confirm admission before activating the task and returning 202.
3. A step rereads the task and atomically claims a lease. Refresh input signatures
   immediately before submission and recheck the enabled connection and kill switch.
4. Commit the transition from queued to submitting **before** sending one provider
   request. Redelivery/restart never repeats that submission. A crash at this
   boundary may leave an unknown outcome that requires provider reconciliation;
   this conservative behavior prevents automatic duplicate charges.
5. Poll the saved operation, honor Retry-After and persist completed media through
   the Blob/S3 adapter. A storage retry reuses the original provider result.
6. Sleep durably between observations, reread state after wakeup and stop on
   deletion, completion, pause or deadline. Adaptive observation intervals are
   10/20/30/120/600 seconds as task age increases. Active leases and provider
   backoff may delay the next check further. This is not a live progress guarantee.

An admission failure cannot authorize submission, even if a late run appears.
An activation database response can be lost after commit; that case returns the
task ID with a recovery warning, rather than inviting another paid request.
Unactivated runs expire safely. A connection disabled before submission prevents
it; existing accepted provider operations can still be observed.

SDK step results contain only a next-wakeup time or null. SQL/provider errors
are reduced to safe codes instead of being serialized into Workflow logs.
Observation defaults to 24 hours, configurable from 30 minutes to 7 days. Runs
enter expiration finalization five minutes after the observation deadline. The
finalizer reclaims expired leases, waits for a live owner using SDK retries, and
preserves a newer deadline established by manual resume. There is no automatic
paid resubmission and no promise of exactly-once delivery by the platform.

## Vercel configuration

Use the [deployment checklist](deployment.md) and [production guide](production.md):

```dotenv
DEPLOYMENT_PROFILE=distributed
TASK_WORKER_MODE=workflow
DATABASE_URL=<migrated-postgresql-connection>
ASSET_STORAGE_MODE=vercel-blob
ASSET_DELIVERY_MODE=private
BLOB_READ_WRITE_TOKEN=<connected-private-store-token>
GENERATION_ENABLED=false
```

S3 is an alternative to Blob. Apply migrations 0001, 0002 and 0003 in order when
missing; runtime code does not apply DDL. Keep operator and provider encryption
secrets stable. Enable **Fluid compute** and **Settings → Environment Variables →
Enable access to System Environment Variables** so `VERCEL_DEPLOYMENT_ID` is
available. The SDK selects the Vercel World from this identifier. Production
rejects local/non-Vercel Workflow targets. For local development only,
`TASK_WORKER_MODE=workflow` uses the SDK's local execution world.

`withWorkflow` wraps the Next configuration. Generated
`/.well-known/workflow/*` handlers use the Workflow queue protocol and bypass
workspace HTTP Basic, as required by the SDK. They are not workspace API routes.
Generated sources and `.workflow-data/` are ignored by Git. Do not apply a blanket
Basic-auth middleware to these handlers. Verify platform delivery when using
Deployment Protection.

The repository no longer installs a minute Cron. Workflow mode needs neither
`CRON_SECRET` nor `TASK_SCHEDULER_CONFIGURED`, and no GitHub scheduler.
`/api/ready` validates configuration and task storage but reports
`workflow_execution: "unverified"`; it cannot establish queue delivery or a
successful Workflow execution. Verify that on the target deployment separately.

## Recovery and operations

Monitor task age, paused/unknown outcomes, Workflow failures, Blob/S3 errors and
Workflow/Functions/Queues usage in Vercel. A database outage defers observation;
if it outlasts run expiry/finalization, repair storage and reconcile explicitly.

Authenticated **POST `/api/internal/reconcile-workflows`** with exact `Origin`
and an empty body starts observers for at most 20 accepted active tasks. Use it
to adopt tasks from the previous external-worker deployment or recover a lost
run after repairing infrastructure. It never activates an unconfirmed request.
The response includes `nextCursor` when a full batch is selected; pass it as
`?after=<nextCursor>` to reach later tasks. Repeated calls can create duplicate observer runs and extra events, but leases
and revisions prevent duplicate paid submission. It is a manual repair action,
not a required periodic scheduler. Check old pending tasks during migration.

Resume a paused task with a saved operation through the existing task endpoint;
Workflow admission precedes the state change, and resume only observes the
original operation. Tasks without a known operation require checking the provider
account. Deletion stops future application writes, not an already accepted
provider job or its billing, and does not delete stored objects automatically.

## Costs and alternative execution modes

Workflows includes a free allowance; it is not unlimited free execution. As of
the review date Hobby includes 50,000 Workflow events/month and 1 GB written.
A normal step produces three events, with additional events for the run and
sleeps. Functions and underlying Queues are metered separately; Blob/S3 storage,
delivery and AI provider charges are separate too. Check current plan limits
before enabling generation. Adaptive sleeps reduce overhead for slow jobs.

Persistent Node/Docker still supports `TASK_WORKER_MODE=local` with one process
and durable disk. `external` remains available with PostgreSQL, an independent
scheduler secret and a configured recurring trigger. Neither uses the Workflow
adapter. See the production guide for the external endpoint contract.

## Official sources

- [Workflow Next.js integration](https://workflow-sdk.dev/docs/getting-started/next)
- [Deployment and worlds](https://workflow-sdk.dev/docs/deploying)
- [Starting workflows](https://workflow-sdk.dev/docs/api-reference/workflow-api/start)
- [Durable sleep](https://workflow-sdk.dev/docs/api-reference/workflow/sleep)
- [Errors and retries](https://workflow-sdk.dev/docs/foundations/errors-and-retries)
- [Vercel Workflows](https://vercel.com/docs/workflows) and
  [pricing](https://vercel.com/docs/workflows/pricing)
- [Vercel Queues pricing](https://vercel.com/docs/queues/pricing)
