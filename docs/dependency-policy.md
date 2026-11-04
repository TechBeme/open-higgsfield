# Dependency and runtime policy

Last reviewed: 2026-11-04.

## Supported runtime

Use Node 22.23.4 or a later security patch in Node 22. CI and the Docker stages
track Node 22; `package.json` records the supported range. Keep `@types/node` on
the same major so declarations do not permit APIs absent from the runtime.
The validated dependency candidate uses npm 10.9.9 bundled with Node 22.23.4.

An update to `package-lock.json` does not update an existing Node process or a
previously built container. Rebuild deployment artifacts with a current Node 22
base image through the deployment procedure. Check `process.version` and
`process.versions.undici` on the actual runtime when verifying a deployment.
Node's bundled fetch implementation and the separately installed `undici` npm
package have different version numbers and require separate security maintenance.

## Updating dependencies

Use the committed lockfile and `npm ci` for local acceptance, CI, and image builds.
Review the actual graph, including optional native packages, after regenerating
the lockfile. Preserve compatible parent constraints; do not use `--force`,
`--legacy-peer-deps`, or `npm audit fix --force` to make an update install.

Keep Next and `eslint-config-next` aligned. Keep React and React DOM at the same
exact version, with corresponding React type declarations. Remain on ESLint 9
until the Next, React, import, and accessibility plugins have a tested ESLint 10
combination. HumanFS 0.17 requires Node 24 and is outside the current runtime
policy. Experimental AI SDK video APIs require provider contract checks even
when their package update is a patch release.

For each candidate:

1. Consult current upstream releases, advisories, engines, and peer constraints.
2. Update only the reviewed direct packages and required transitive fixes. Keep
   the manifest and npm-generated lockfile together.
3. Perform a clean install, inspect `npm ls --all`, and run both audit gates.
4. Run lint, typecheck, regression tests, native media decoding, and the production
   build on the supported runtime. For UI/SDK changes, check the affected browser
   and provider flows with synthetic fixtures and blocked external generation.
5. Obtain independent review of the resulting code and evidence before release.

No data migration is part of a dependency-only update. Manifest, lockfile, CI,
and this policy form one reviewed candidate. A local rollback requires a clean
reinstall and repeated checks. If optional grouped library updates fail, prepare
a security-only candidate that retains every required security fix; do not use a
known-vulnerable runtime or package graph as a routine production rollback.

## Required checks

`npm run check` runs lint, typecheck, `npm test`, and build. `npm test` discovers
`scripts/verify-*.mjs`. Missing tests must fail. Historical review reproductions
are not part of the test command. The CI workflow uses explicit steps
for the same checks and supplies an isolated PostgreSQL 16 service to integration
tests. `REQUIRE_POSTGRES_TESTS=1` makes missing PostgreSQL test configuration a
failure instead of a skipped integration suite.

For a local PostgreSQL run, provide `TEST_POSTGRES_HOST` (a local hostname or Unix
socket directory), `TEST_POSTGRES_PORT`, `TEST_POSTGRES_DB`,
`TEST_POSTGRES_USER`, and `TEST_POSTGRES_PASSWORD` for a dedicated disposable
database, then run `REQUIRE_POSTGRES_TESTS=1 npm test`. Tests use unique schemas;
never supply production database connection details.

CI runs `npm run audit:dependencies`, which executes both a production audit and
an all-dependency audit with JSON output. The production graph must have no
advisories. The full graph must have no high or critical advisories; the only
temporary exception is the exact `GHSA-g3hv-75wg-m249` minimatch advisory on the
reviewed development-only copy, through 2026-11-30 UTC. The gate validates
the npm report schema, lockfile paths and versions, development scope, advisory
graph, and expiry. Any new advisory, production copy, malformed report, audit
service failure, or expired exception fails closed. An npm exit code of 1 is
accepted only when it contains a valid vulnerability report; npm errors and
timeouts are failures. `npm run check` includes the same gate.

Do not replace this narrow gate with `npm audit --audit-level=high`: that command
would silently allow unrelated moderate findings. Do not use `npm audit fix --force`
to bypass peer or runtime constraints.

Do not supply provider keys, application `DATABASE_URL`, or storage credentials
to acceptance tests or builds. Disable Next telemetry with
`NEXT_TELEMETRY_DISABLED=1`. CI's PostgreSQL credentials are synthetic and scoped
to its disposable service. A local green test run does not prove an external
provider contract, deployment configuration, or production runtime version.

## Current exception

Independent QA accepted the following development-tooling exception on 2026-10-31:

| Item | Accepted boundary |
| --- | --- |
| Advisory | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), minimatch glob-pattern amplification |
| Installed copy | `node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch` 10.2.4 |
| Scope | Development-only lint/TypeScript tooling; audit also reports affected consumers as metapackages |
| Compatibility limit | The fixed 11.0.1 release changes the contract used by legacy minimatch consumers; forcing it or downgrading ESLint is not an approved remediation |
| Boundaries | Repository-controlled lint configuration, read-only CI permissions, 25-minute job timeout; no application endpoint accepting glob patterns was found |
| Revisit | Compatible upstream fix/toolchain, introduction of untrusted glob input, or 2026-11-30, whichever comes first |
| Review | Independently reviewed on 2026-10-31 within the boundaries above |

This exception does not cover a new advisory, a production dependency, or a new
application use of minimatch. Keep audit findings visible. The advisory describes
`optimizationLevel >= 2`; its current published affected range is
`>=7.0.0 <11.0.1`. The older `minimatch` 3.x copy is outside that range and is
not accepted as part of this exception.

The committed manifest and lockfile record the selected versions. Re-run the
checks above before release; the dated exception is not a current audit result.

## Main branch change flow

The protected `main` branch requires the exact `quality` check. Administrators are
subject to the same protection, and direct pushes and administrative bypasses are
not part of the release process. The repository has a single maintainer, so the
branch rule does not require a human approval count. Create a short-lived branch,
open a pull request, wait for the checked head's `quality` result, and merge that
reviewed commit normally. Verify the final commit and successful checks after the
merge.

## Blob SDK transitive security patch (2026-11-04)

`@vercel/blob` 2.8.2 resolves OIDC 3.8.10, which pins `@vercel/cli-config` 0.3.1
and vulnerable Zod 4.1.11 (GHSA-mrhx-c7xc-m3w5). A narrowly scoped npm override
selects the official cli-config 0.3.6 patch, whose Zod constraint is ^4.6.6.
This retains the OIDC major required by Blob rather than forcing a major SDK
upgrade or accepting a production advisory. Revisit the override when Blob's
supported OIDC range includes an upstream corrected dependency chain. The
lockfile, regression suite and both audit gates must pass with this override.

## Workflow SDK transitive security patches (2026-11-04)

`workflow` 5.3.0 introduces runtime/build dependencies with older Zod, Undici and
minimatch pins. The committed overrides select the existing direct Zod 4.6.7,
Undici 7.30.1 for the vulnerable 7.30.0 copies, and minimatch 11.0.1 for
`@vercel/queue`, `@oclif/core`, `@swc/cli` and `filelist`. These consumers were
reviewed against their actual named `minimatch()` / `match()` APIs; regression
tests exercise the resolved copies. Unlike the legacy development copy
above, these SDK consumers support the corrected contract. This adds no audit
exception. Revisit overrides when upstream dependencies adopt fixed versions.
Clean install, production build, SDK runtime smoke, regressions and both audit
gates must pass; do not run concurrent npm mutations on one dependency tree.

## Advisory metadata refresh (2026-11-04)

The official GitHub advisory was updated at 16:50 UTC to narrow the affected
range to `>=7.0.0 <11.0.1`; npm now identifies it as source 1244623. The exact
audit gate follows that revised identity and only the reviewed TypeScript
tooling copy 10.2.4. It rejects the superseded wider range, old source ID and
legacy 3.x node. The existing expiry and development-only limits are unchanged.
