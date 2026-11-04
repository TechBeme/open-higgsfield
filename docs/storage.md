# Media storage and downloads

New tasks store media references, never base64 output bytes. Storage finishes
before a task can be published as completed. Provider submission is not retried
when storage fails; an asynchronous operation can be observed again, while a
lost synchronous byte-only result requires operator attention.

## Supported profiles

For one persistent server process, set `ASSET_STORAGE_MODE=local` and an absolute
`OPEN_HIGGSFIELD_STORAGE_DIR` on a persistent disk. Production requires both
explicitly. Local development without database/serverless configuration defaults
to local mode. Back up task history and the uploads/downloads directories together.

With `DATABASE_URL`, Vercel or a distributed deployment, use **Vercel Blob**
(recommended on Vercel) or **S3**. These profiles store both uploaded references
and generated images/videos remotely, without relying on ephemeral local disk.

### Vercel Blob

Create a **private** Blob store under Storage in the Vercel dashboard and connect
it to the project. Vercel supplies `BLOB_STORE_ID` and its short-lived
`VERCEL_OIDC_TOKEN` system variable automatically. Configure:

```dotenv
ASSET_STORAGE_MODE=vercel-blob
ASSET_DELIVERY_MODE=private
# Only needed for local/non-Vercel hosts; Vercel uses OIDC automatically.
# BLOB_READ_WRITE_TOKEN=<server-side-store-token>
```

The store ID is read from `BLOB_STORE_ID` for OIDC, or inferred from a static
token when one is used. The store's actual access setting must match
`ASSET_DELIVERY_MODE`. The app uses
the official Blob SDK, immutable content-addressed uploads and exact-path,
GET-only delegated signed URLs. No store-wide read token is sent to a browser or
AI provider. A public Blob store is supported only with explicit
`ASSET_DELIVERY_MODE=public`; anyone with those object URLs can access originals.

### S3 and compatible services

```dotenv
ASSET_STORAGE_MODE=s3
ASSET_DELIVERY_MODE=private
S3_BUCKET=your-private-media-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=<server-side-access-key>
S3_SECRET_ACCESS_KEY=<server-side-secret>
```

Use a private bucket and an IAM policy restricted to `s3:GetObject` and
`s3:PutObject` on `arn:aws:s3:::BUCKET/open-higgsfield/*`; bucket listing and
object deletion are not needed by this adapter. With no explicit credentials,
the official AWS SDK uses its native credential chain (e.g. an IAM role).
`S3_SESSION_TOKEN` supports temporary credentials. Their expiry can shorten the
validity of a signed URL, even if a longer TTL was requested.

For compatible storage, set `S3_ENDPOINT` to a public HTTPS origin (no path,
credentials or port), `S3_REGION` as required by that service, and optionally
`S3_FORCE_PATH_STYLE=true`. Public delivery requires explicit
`ASSET_DELIVERY_MODE=public` and `S3_PUBLIC_BASE_URL` as an HTTPS origin mapped to
the bucket root. The app does not change bucket ACLs or policies. In public mode,
inline/provider URLs use that origin; attachment URLs use native S3 signing.
Compatibility depends on conditional PUT, HEAD and SigV4 support.

### Private delivery and lifecycle

Output records contain stable references, not signed URLs. Browser-facing DTOs
retain `/api/download/...` URLs; inputs retain `/api/uploaded/...` URLs. After app
request validation, these routes redirect to a fresh signed object URL, valid for
15 minutes. Downloads use the storage provider's native attachment option.
Reusing media in a generation creates a fresh 24-hour provider link. These links
are bearer credentials: anyone receiving one can read that exact file until it
expires. A generated link is intentionally accessible to the selected AI
provider, without giving it the workspace credential. Expired links can be
renewed through the stable application routes.

Known managed objects redirect directly, including large videos and byte-range
playback, avoiding Vercel's response-body limit. The storage service handles
ranges; a 307 redirect preserves the request method/headers. No response stream
of large managed media passes through the app function. Uploaded images retain
the existing JPEG normalization and media validation. Storage and signing errors
are returned as canonical codes, with no SDK messages or credentials.

Writes use deterministic task/index/content-hash keys and refuse overwrites;
existing objects must match size/MIME. New task references are published only
after all outputs finish. Partial failures can leave unreferenced objects.
Deleting a gallery entry does **not** delete its Blob/S3 object, matching the
existing retention behavior. Configure lifecycle/retention and monitor usage
separately. No bulk deletion, storage migration or automatic bucket creation is
performed. Changing store/bucket/backend does not migrate old references;
restore the previous configuration or migrate them explicitly.

### Legacy Cloudinary profile

```dotenv
ASSET_STORAGE_MODE=cloudinary
ASSET_DELIVERY_MODE=public
CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
```

The existing separate `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and
`CLOUDINARY_API_SECRET` fields are also supported. Keep credentials server-side.
Do not use a real key in examples, tests or browser code.

`ASSET_DELIVERY_MODE=public` is an explicit acknowledgement: anyone with an
original Cloudinary CDN URL can access the asset. Protecting the studio does not
make CDN originals private. Reference uploads are public too. Private media
delivery is not implemented by this profile; do not configure it for a workflow
requiring private originals. See the [production runbook](production.md) for
access, deployment and generation enablement.

The application uses Cloudinary's native signed REST upload with SHA-256,
`overwrite=false`, explicit resource type and validated response identity. Output
IDs include task, result index and the SHA-256 of the bytes. The same bytes reuse
the same ID; a stale worker returning different bytes cannot overwrite another
worker's output. Local files use the same content-addressed rule, temporary file
sync, exclusive publication and directory sync. Task deletion does not delete
Cloudinary objects or files. Failed attempts may leave unreferenced immutable
media; review retention and costs separately before performing any cleanup.

## Resource and deployment limits

| Boundary | Limit |
| --- | --- |
| Complete browser generation multipart body | 4 MiB, including all fields/files/framing; 30-second read deadline |
| Image media transfer/output | 20 MiB |
| Video media transfer/output | 64 MiB |
| Audio reference transfer | 20 MiB |
| Input image decoding | 40,000,000 total pixels, including declared pages |
| Media transfer/upload operation | 60 seconds, shortened by caller cancellation/deadline |
| Cloudinary upload JSON response | 64 KiB |
| Vercel application-relayed media response | 4 MiB |
| History page | 20 tasks by default, maximum 50 through the API |

The media limits do not enlarge the browser request limit. Use supported public
reference URLs for inputs that do not fit the aggregate multipart budget. No
direct browser-to-object-store upload flow is included.

Remote downloads allow only public HTTP(S) addresses. The native transport pins
the checked DNS address, retains normal hostname/TLS verification, sends no
application credentials and refuses redirects. Both declared and streamed bytes
are checked. Input/output files use a MIME/signature allowlist; HTML, SVG and
unknown content are rejected. Upload suffixes are derived from known MIME types.

## Legacy records and delivery

Existing data URLs are not automatically migrated or uploaded. The private
download route still resolves one legacy record, with strict base64/MIME/size
checks. A missing local image file falls back to its retained data/remote URL for
both indexed preview and single-image attachment. Missing local API references
are never fetched recursively. Expired upstream-only URLs may no longer work.

Known immutable generated Cloudinary outputs redirect to validated public CDN
URLs; attachment requests use Cloudinary's documented attachment flag. They do
not send the media through the application function. Cloudinary account-specific
delivery/transformation settings remain an operator verification requirement.

Local files stream asynchronously with cancellation and private/no-store caches.
The 60-second operation deadline remains active through local opening and
streaming, including uploaded files and an unconsumed response.
The uploaded-input route applies the same containment, MIME, no-follow and cache
policy. Single byte ranges support bounded, open-ended and suffix forms; 206
includes Content-Range, unsatisfiable ranges return 416 and malformed or multiple
ranges return 400. No multipart-range or ZIP implementation is claimed.

On Vercel, legacy/app-relayed full output above 4 MiB returns 413 with
`ERR_LEGACY_ASSET_REQUIRES_MIGRATION` before emitting media. A local file can still
serve a requested slice of at most 4 MiB. Legacy remote proxy downloads are capped
at 4 MiB there, including chunked responses. Self-hosted persistent mode retains
the larger media limits. Export/migrate large legacy assets deliberately, or
retrieve them from a compatible persistent host; there is no automatic upload,
database rewrite or promise that all legacy media works through serverless.

## Compatibility and rollout

History uses `?limit=20&cursor=...` with `{tasks,nextCursor}`. A request without
pagination temporarily receives a bounded legacy array. The public DTO contains
download references, output counts and `has_download`; it omits local paths,
operations and inline bytes. The actual ResultsGrid offers Load more, reports
history errors, and refreshes current task state after SSE reconnects. A paused
task shows needs-attention text and must not be resubmitted automatically.
Download controls explicitly request attachment delivery; image/video previews
retain their inline URLs. The retained multi-image card offers one attachment
link per output rather than labeling a JSON listing as a downloadable archive.

Save-to-gallery retains its request shape and returns `{saved:true,url}` with an
application download reference. It no longer returns a server filesystem path;
it does not copy already stored media or migrate legacy records.

Back up task data and files before adopting the new profile. Configure durable
storage and verify the chosen delivery policy before enabling paid generation. Rollback must keep
new durable URLs readable: the old reader cannot reliably download Cloudinary-only
records. Stop writes and restore a matching backup/application together for a
full rollback, reconciling paid tasks created since backup. Never delete durable
objects as part of code rollback. The task schema/writer migration is documented
in the [production runbook](production.md#activation-monitoring-and-recovery).

Local verification uses synthetic media, mocked Blob/S3/Cloudinary boundaries,
real offline AWS SDK signing, native
HTTP/DNS boundary doubles, and actual local files. It does not establish that a
production volume is persistent, Cloudinary account delivery works, or a real
provider generation succeeds.

## Official references

- [Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk),
  [private storage](https://vercel.com/docs/vercel-blob/private-storage),
  [signed URLs](https://vercel.com/docs/vercel-blob/vercel-signed-urls)
- [AWS S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html),
  [presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html),
  [JavaScript SDK examples](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html)
- [Cloudinary signed upload API](https://cloudinary.com/documentation/image_upload_api_reference)
  and [media access control](https://cloudinary.com/documentation/control_access_to_media)
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Node 22 HTTP](https://nodejs.org/docs/latest-v22.x/api/http.html)
  and [filesystem](https://nodejs.org/docs/latest-v22.x/api/fs.html)
- [HTTP range semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)
- [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/)
- [SWR pagination](https://swr.vercel.app/docs/pagination)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
