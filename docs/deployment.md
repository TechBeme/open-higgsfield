# Deployment

Follow the [production operator guide](production.md) before starting production.
It requires a single-operator credential, HTTPS, an explicit storage/execution
profile and deliberate generation enablement.

- **Persistent Node/Docker:** one process with a mounted data volume and startup
  worker recovery. Keep the HTTP application port behind an HTTPS reverse proxy.
- **Vercel/distributed:** migrated PostgreSQL, explicitly public Cloudinary media
  and authenticated recurring observation. The included minute cron requires
  Pro/Enterprise; Hobby daily cron is not this deployment profile.

Every authenticated person shares all tasks and provider spending authority.
There are no multi-user ownership boundaries, application monetary caps or global
rate limits. Configure provider quotas and ingress controls before enabling work.
Cloudinary originals remain public by URL even with application authentication.

See [storage](storage.md) for media/legacy compatibility and
[production](production.md) for environment settings, HTTPS, migration, scheduler,
readiness, monitoring and rollback. There is no runtime database DDL or
database-to-file fallback.

## Updating an existing Vercel deployment

The gallery selection and mobile composer layout update adds **no environment
variables or migrations**. If the existing deployment already meets the
production configuration below, deploy the updated `main` and verify the UI.

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
   both `migrations/0001_durable_task_lifecycle.sql` and
   `migrations/0002_provider_runtime_catalog.sql`. Review/apply missing migrations
   as a separate database operation; the application does not apply them at boot.
4. The bundled `vercel.json` runs `/api/internal/process-tasks` every minute and
   requires **Pro or Enterprise**. Hobby permits only daily cron, which does not
   satisfy this profile. Confirm scheduled invocations and the correct
   `CRON_SECRET` before declaring generation ready.
5. Environment-variable changes take effect in a **new deployment**. Redeploy
   after changing them; editing a variable does not update an existing deployment.
6. Verify the new deployment: public `/api/health` returns `{"status":"alive"}`;
   authenticated `/api/ready` returns `ready: true`; Providers and Studio load in
   `en`, `pt-BR` and `es`; saved connections, gallery downloads, image selection,
   and mobile controls work. `/api/ready` does not prove that cron is arriving or
   that a provider can generate. Check scheduler logs separately. An actual
   generation test consumes provider credit and is a separate step.

Required server-side settings for the supported Vercel profile:

| Setting | Expected value |
| --- | --- |
| `APP_ORIGIN` | Exact public HTTPS origin, without trailing slash or path |
| `APP_ACCESS_USER`, `APP_ACCESS_PASSWORD` | Existing operator credential; password must meet the [operator guide](production.md) requirements |
| `PROVIDER_CONFIG_ENCRYPTION_KEY` | Stable secret for saved provider connections |
| `DEPLOYMENT_PROFILE`, `TASK_WORKER_MODE` | `distributed`, `external` |
| `DATABASE_URL` | Migrated PostgreSQL/Neon database |
| `ASSET_STORAGE_MODE`, `ASSET_DELIVERY_MODE` | `cloudinary`, `public` |
| `CLOUDINARY_URL` | Cloudinary credentials, or the three separate variables in `.env.example` |
| `CRON_SECRET`, `TASK_SCHEDULER_CONFIGURED` | Independent scheduler secret, `true` after recurring execution is configured |
| `GENERATION_ENABLED` | `true` only when storage, scheduling and provider limits are ready |

Configure provider credentials through **Providers** or server environment
variables, such as `RUNWARE_API_KEY`. Keep Preview environments isolated from
production credentials, task data and spending authority. See the operator guide
for HTTPS origins and preview/deployment-protection considerations.

Official Vercel references (checked November 4, 2026):

- [GitHub integration and production deployments](https://vercel.com/docs/git/vercel-for-github)
- [Environment variables](https://vercel.com/docs/environment-variables)
- [Cron job limits by plan](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
