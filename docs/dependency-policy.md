# Dependency and runtime policy

Last reviewed: 2026-10-31.

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

CI runs `npm audit --omit=dev --audit-level=info` and
`npm audit --audit-level=high`. The production graph must have no advisories. The
full graph must have no high or critical advisories; every remaining lower-severity
finding still requires explicit review and a bounded exception. An unavailable
audit service is a failed/unverified check, not an empty report.

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
| Installed copies | `node_modules/minimatch` 3.1.5 and `node_modules/@typescript-eslint/typescript-estree/node_modules/minimatch` 10.2.4 |
| Scope | Development-only lint/TypeScript tooling; audit also reports affected consumers as metapackages |
| Compatibility limit | The fixed 11.0.1 release changes the contract used by legacy minimatch consumers; forcing it or downgrading ESLint is not an approved remediation |
| Boundaries | Repository-controlled lint configuration, read-only CI permissions, 15-minute job timeout; no application endpoint accepting glob patterns was found |
| Revisit | Compatible upstream fix/toolchain, introduction of untrusted glob input, or 2026-11-30, whichever comes first |
| Review | Independently reviewed on 2026-10-31 within the boundaries above |

This exception does not cover a new advisory, a production dependency, or a new
application use of minimatch. Keep audit findings visible. The advisory describes
`optimizationLevel >= 2`; its published affected range is retained as reported,
without claiming every installed consumer is demonstrably exploitable.

The committed manifest and lockfile record the selected versions. Re-run the
checks above before release; the dated exception is not a current audit result.
