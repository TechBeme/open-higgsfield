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

With `DATABASE_URL`, Vercel or a distributed deployment, set:

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
storage and public delivery before enabling paid generation. Rollback must keep
new durable URLs readable: the old reader cannot reliably download Cloudinary-only
records. Stop writes and restore a matching backup/application together for a
full rollback, reconciling paid tasks created since backup. Never delete durable
objects as part of code rollback. The task schema/writer migration is documented
in the [production runbook](production.md#activation-monitoring-and-recovery).

Local verification uses synthetic media, a fake Cloudinary boundary, native
HTTP/DNS boundary doubles, and actual local files. It does not establish that a
production volume is persistent, Cloudinary account delivery works, or a real
provider generation succeeds.

## Official references

- [Cloudinary signed upload API](https://cloudinary.com/documentation/image_upload_api_reference)
  and [media access control](https://cloudinary.com/documentation/control_access_to_media)
- [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Node 22 HTTP](https://nodejs.org/docs/latest-v22.x/api/http.html)
  and [filesystem](https://nodejs.org/docs/latest-v22.x/api/fs.html)
- [HTTP range semantics, RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)
- [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor/)
- [SWR pagination](https://swr.vercel.app/docs/pagination)
- [Vercel function limits](https://vercel.com/docs/functions/limitations)
