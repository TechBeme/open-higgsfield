# Deployment

Follow the [production operator guide](production.md) before starting production.
It requires a single-operator credential, HTTPS, an explicit storage/execution
profile and deliberate generation enablement.

- **Persistent Node/Docker:** one process with a mounted data volume and startup
  worker recovery. Keep the HTTP application port behind an HTTPS reverse proxy.
- **Vercel/distributed:** migrated PostgreSQL, durable Blob/S3 media
  and Vercel Workflows for durable background execution. No recurring Cron is
  required. Workflows, Functions, Queues and storage have separate usage limits.

Every authenticated person shares all tasks and provider spending authority.
There are no multi-user ownership boundaries, application monetary caps or global
rate limits. Configure provider quotas and ingress controls before enabling work.
Blob/S3 originals default to private with signed links; legacy Cloudinary
originals remain public by URL even with application authentication.

See [storage](storage.md) for media/legacy compatibility and
[production](production.md) for environment settings, HTTPS, migration, Workflow execution,
readiness, monitoring and rollback. There is no runtime database DDL or
database-to-file fallback.

## Updating an existing Vercel deployment

This update adds Blob/S3 storage and Vercel Workflows. Apply the missing forward
migrations, configure the execution/storage profiles below and verify the new
deployment before enabling paid generation.

1. In the Vercel project, confirm the Git integration points to
   `TechBeme/open-higgsfield` and the Production Branch is `main`. With automatic
   deployments enabled, a merge to `main` creates a production deployment.
   Otherwise, create a deployment from the updated branch. Use the Next.js
   framework preset, `npm ci`, `npm run build`, and the default Next.js output.
   The repository pins Node to the 22 release line; use Node.js **22.x**.
2. Review the **Production** environment variables. Keep the existing
   `PROVIDER_CONFIG_ENCRYPTION_KEY`: replacing it makes saved provider connections
   unreadable. Local `.env.local` files, downloaded media and local provider
   configuration are ignored by Git and are not transferred to Vercel.
3. For an older installation that has not adopted the production storage profile,
   back up first and follow the [operator guide](production.md). The schema needs
   `migrations/0001_durable_task_lifecycle.sql`,
   `migrations/0002_provider_runtime_catalog.sql` and
   `migrations/0003_workflow_queue.sql`, in that order. Review/apply missing migrations
   as a separate database operation; the application does not apply them at boot.
4. Enable Fluid compute and access to System Environment Variables in the Vercel
   project settings. Confirm `VERCEL_DEPLOYMENT_ID` is available at runtime. Set
   `TASK_WORKER_MODE=workflow`; no Cron or scheduler secret is needed. After
   switching, use the authenticated recovery endpoint described in
   [background execution](background-execution.md) for previously accepted tasks.
5. Environment-variable changes take effect in a **new deployment**. Redeploy
   after changing them; editing a variable does not update an existing deployment.
6. Verify the new deployment: public `/api/health` returns `{"status":"alive"}`;
   authenticated `/api/ready` returns `ready: true`; Providers and Studio load in
   `en`, `pt-BR` and `es`; saved connections, gallery downloads, image selection,
   and mobile controls work. `/api/ready` does not prove Workflow delivery or
   that a provider can generate. Check a synthetic Workflow execution separately. An actual
   generation test consumes provider credit and is a separate step.

Required server-side settings for the supported Vercel profile:

| Setting | Expected value |
| --- | --- |
| `APP_ORIGIN` | Exact public HTTPS origin, without trailing slash or path |
| `APP_ACCESS_USER`, `APP_ACCESS_PASSWORD` | Existing operator credential; password must meet the [operator guide](production.md) requirements |
| `PROVIDER_CONFIG_ENCRYPTION_KEY` | Stable secret for saved provider connections |
| `DEPLOYMENT_PROFILE`, `TASK_WORKER_MODE` | `distributed`, `workflow` |
| `DATABASE_URL` | Migrated PostgreSQL/Neon database |
| `ASSET_STORAGE_MODE`, `ASSET_DELIVERY_MODE` | `vercel-blob`, `private` (or the documented S3 profile) |
| `BLOB_STORE_ID`, Vercel OIDC system environment | Automatically supplied by the connected private Blob store; a static `BLOB_READ_WRITE_TOKEN` is only needed outside Vercel; S3 uses its own credentials |
| Vercel project settings | Fluid compute and access to System Environment Variables enabled |
| `GENERATION_ENABLED` | `true` only when storage, Workflow delivery and provider limits are ready |

Configure provider credentials through **Providers** or server environment
variables, such as `RUNWARE_API_KEY`. Keep Preview environments isolated from
production credentials, task data and spending authority. See the operator guide
for HTTPS origins and preview/deployment-protection considerations.

Official Vercel references (checked November 4, 2026):

- [GitHub integration and production deployments](https://vercel.com/docs/git/vercel-for-github)
- [Environment variables](https://vercel.com/docs/environment-variables)
- [Workflow integration](https://workflow-sdk.dev/docs/getting-started/next) and [deployment](https://workflow-sdk.dev/docs/deploying)
- [Workflow pricing](https://vercel.com/docs/workflows/pricing)
- [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
