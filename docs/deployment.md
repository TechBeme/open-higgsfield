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
