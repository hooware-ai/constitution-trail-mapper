# Web release check

This is the reproducible, clean-source path from a checkout to a verified web artifact. It prepares and verifies; it does not deploy. The default is a synthetic fixture review build and is not publishable as a real product. The committed county composition is now approved under Jesse’s [October 9 public-launch decision](public-launch-20261009.md): 254 existing county features, four reviewed OSM paths and the existing access-road package; six proposed geometries remain excluded. The existing Site is public. Historical unapproved-candidate measurements remain evidence of those earlier candidates, not current approval state.

After the applicable exact-head release gates pass and the county package/core are verified, `npm run build:public` builds the strict approved county artifact from clean source, with the public channel enabled and the private estimated-connection override disabled. It rechecks provenance, every artifact file and public eligibility. It does not run all release tests, deploy or authorize new data/services. See [hosting-runbook.md](hosting-runbook.md) for exact source/archive publication and rollback.

## One command

From a clean checkout with no prebuilt Kotlin output:

    cd webApp
    npm run release:check

(`node tools/release.mjs` is the same thing and needs no `npm ci` first.) Options: `--skip-install`, `--skip-e2e`, `--allow-dirty` (local only; the artifact is recorded as non-releasable), `--public` (require an approved dataset; the default fixture still fails this check) and `--dataset county` (build the packaged county artifact instead of the fixture; see [county-dataset.md](county-dataset.md)).

It runs, in order, and stops at the first failure:

1. Tool check: Node 22.12+, the JDK Gradle will use is 21+, no uncommitted tracked changes (unless `--allow-dirty`).
2. `npm ci` - locked dependencies only.
3. `:webBridge:jvmTest :webBridge:jsNodeTest` - the shared Kotlin bridge tests.
4. Kotlin core build (`tools/build-core.mjs`): the old generated output is **deleted first**, then `:webBridge:jsBrowserProductionLibraryDistribution` runs and a **core manifest** (`webBridge/build/trail-core.manifest.json`) records a hash of every Kotlin/Gradle input and of every produced file.
5. Type check and unit tests.
6. `vite build`, whose `verify-kotlin-core` plugin refuses to bundle unless the core on disk matches the manifest **and** the manifest matches the current sources.
7. `tools/write-provenance.mjs --strict` writes `dist/provenance.json` (see below); `tools/audit-dist.mjs` scans the exact files for local review assets and credential patterns and re-verifies every hash.
8. Desktop + mobile (Pixel 7) browser suite against the dev server on a **free port this run owns**; the server is never reused (an occupied port fails the run instead of silently testing another checkout).
9. Built-artifact smoke tests (`tests/dist`) against `dist/` served by `tools/serve-dist.mjs` with the production header policy from `hosting/headers.mjs`, on another owned port.
10. The county-mode browser suite on **synthetic** packaged data (`playwright.county.config.ts`, six adjacent owned ports: review, public, OSM, access, Proposed control and all-layer credits variants). It is what proves the production loading path, failure handling and saved-route revalidation whatever dataset the main artifact carries.
11. A final re-audit, then a summary of commit, core, dataset and artifact hashes. A machine-readable step log is written to `webApp/dist-report/release-report.json`.

`npm run build` alone is safe too: it verifies the core manifest first, so it can no longer bundle a stale or hand-copied Kotlin library. If the manifest is missing or stale it stops and says to run `npm run build:core` (which now also writes the manifest) or the release check.

## Required tools (honest list)

- **JDK 21+** (`JAVA_HOME`, or first on `PATH`) and the **Gradle wrapper** in the repository.
- **Android SDK.** The Gradle build still _configures_ the Android modules even though the web task does not build them, so `sdk.dir` (in an untracked `local.properties`) or `ANDROID_HOME` must point at an installed SDK. Hosted GitHub Ubuntu images ship one; CI writes `local.properties` from it. No Android build or device is needed, and **no iOS/macOS tooling** is needed at all.
- **Node 22.12+** and npm (the lockfile is `webApp/package-lock.json`).
- Network access for `npm ci`, Gradle dependency resolution and `playwright install chromium`.

## Stale-core protection

The web bundle imports a generated Kotlin library that is not tracked in Git. Protection is layered:

- the core build removes previous output before it starts, so a failed build cannot leave an old library behind;
- the manifest hashes _inputs_ (both Kotlin modules' sources, the shared Gradle configuration, the wrapper scripts and jar and the Kotlin/JS dependency lock; text with line endings normalised so Windows and Linux agree) and _outputs_, and the input hash is captured **before** the compiler runs and compared **after**: if a source changed during the build, the output and manifest are discarded;
- `vite build` and `npm run build` verify both before bundling: changed Kotlin/Gradle source, a missing manifest, or a copied/edited output all stop the build with an instruction;
- provenance records the input and output hashes and `audit-dist` re-verifies them, so an artifact cannot claim a core it was not built with.

Unit tests (`tests/unit/core-provenance.test.ts`) prove each of these rejections, including the source-change case, on a temporary repository.

## What "clean" means

The recorded commit must describe what was built: tracked changes **and untracked, non-ignored files** (a stray Kotlin or config file the commit does not contain) make the tree dirty and the artifact non-releasable. Ignored build output (`build/`, `dist/`, `node_modules/`) does not.

## Provenance (`dist/provenance.json`)

    schema, artifact, builtAt
    source     { commit, branch, dirty }
    core       { inputsSha256, outputSha256, builtAt }
    dataset    { kind, id, version, approved, contentSha256, license }
    publicRelease { allowed, blockers[] }
    tools      { node }
    files[]    { path, sha256, bytes }   (every file in dist/ except provenance.json)
    filesSha256

The file is served as-is, so a deployed site can be matched to the commit, core and dataset it came from. It contains no secrets.

## Dataset identity (the #47 contract)

For a fixture build, `webApp/release/dataset.json` declares which dataset the artifact ships. A county build (`TRAIL_DATASET=county`) instead ships `data/dataset.json` + a hash-named `data/trails.<sha12>.json`, and the audit takes the dataset from those shipped files plus the committed `release/dataset.county.json` approval record (details in [county-dataset.md](county-dataset.md)). The default remains the synthetic fixture (`kind: "fixture"`, `approved: false`), so its `publicRelease.allowed` is false and `--public` fails for that fixture. The approved county package can pass the strict public gate; approval is bound to the exact committed composition, not arbitrary replacement data.

`tools/audit-dist.mjs` never trusts what `provenance.json` says about itself: it recomputes the file hashes, the core hashes, the dataset identity and the **public-release verdict** from the evidence and rejects any difference (a hand-edited `allowed: true`, or an approval flag added to an unchanged fixture, is refused). With `--public` the artifact must also be eligible _now_: the current clean commit equals the recorded one, and an approved dataset's content must be a file in the artifact with the declared hash (`content.distPath`).

A file scan passing is never approval. A real dataset can only become releasable when its record carries **all** of: `id`, `version`, `content.sha256` and `content.distPath` (the shipped data file and its hash), `sourceManifestSha256` (the reviewed-subset manifest), `licenseEvidence`, `attribution`, `approvedBy` and `approvedOn`, on a clean commit. Marking a fixture approved does not work. Which sources may be combined (county subset, proposed segments, OSM-derived graph) and who approves it are #47 decisions; this slice defines the seam, not the answer.

## CI

`.github/workflows/web-release-check.yml` runs the same check on pull requests and pushes that touch the web, bridge, shared-logic or Gradle files: JDK 21, Node 24, a locked install, `npm run release:check`, and a negative check that a production build without the core manifest fails. It uploads `dist/` and `dist-report/` (14 days) labelled fixture-only. It has read-only permissions, no secrets, no deploy step and no cloud access. Its first hosted run failed because the wrapper script is committed without its executable bit; the check now runs the wrapper through `sh` and the tracked mode is fixed. See the pull request for the latest hosted result.

A second, independent workflow, `.github/workflows/web-firestore-rules.yml` (**Web Firestore rules**), runs the local-emulator Firestore rules tests and negative controls; it does not change this release check. See [cloud-library-contract.md](cloud-library-contract.md#hosted-check-web-firestore-rules).

## What this does not certify

The current public launch is guest-first (route planning, foreground navigation and browser-local saves, no sign-in). Real-data composition and existing hosting were approved for that release. Physical iPhone/Android/GPS acceptance (#41) remains NOT RUN; Jesse chose public feedback to inform further testing rather than holding launch for it. Authentication and cloud sync (#31-#33, #51) are deferred to a later phase and are not first-launch dependencies. Built-artifact smoke tests use the fixture network (or, for `--dataset county`, check the county files, headers and provenance); automated runs never request map tiles. The historical `fetch-web-review-data.py`, `package:dataset` and county `release:check` sequence regenerates or reviews a package; it does not approve changed inputs or produce the strict deployable build by itself. Use `npm run build:public` over the exact committed approved package for the public artifact. See [county-dataset.md](county-dataset.md) for historical measurements and packaging commands.

## Browser port preflight

`TRAIL_TEST_PORT` must be a decimal integer from 1 through 65535 and an HTTP port browsers allow. Playwright configurations, Vite and the artifact preview and synthetic county servers reject invalid or Fetch-blocked ports before starting a server (for example 4190). The county configuration validates its complete range from base through base + 5, so a valid base beside a blocked port also refuses. Defaults and explicit safe selections are unchanged. Direct preview server `--port` values use the same validation.

Automatic release allocation skips blocked candidates and probes every required port while holding the successful binds, then releases the probes before the owned servers start. The county allocation checks all six ports, including its last variant. There is still a bind race between probing and starting; strict-port/no-reuse servers fail visibly on a competing listener rather than switching to another checkout. This does not disable browser restrictions or certify a physical device. Port policy: [Fetch Standard, port blocking](https://fetch.spec.whatwg.org/#port-blocking), checked 2026-10-09.

Each synthetic county server binds its actual HTTP listener **before** generating its package or building its artifact. During preparation it returns `503` with `Cache-Control: no-store`, then serves the completed artifact on the same listener. A busy port refuses before preparation can modify files; a failed preparation exits and releases that server's listener. `--build-only` continues to build without listening. This shortens the probe-to-bind gap; it does not reserve all six ports atomically or make a competing listener impossible. Artifact preview and county bind failures include bounded socket states and numeric PIDs when Linux `ss` can observe them; unavailable diagnostics do not change the failure. There is no port fallback, server reuse, automatic retry or termination of another owner.

## Served artifact identity preflight

Built-artifact browser runs compare the server's `/provenance.json` bytes with the selected local artifact before browser tests. This also applies to an explicit `TRAIL_REUSE_SERVER=1`: a valid older artifact cannot stand in for the artifact being checked. Matching owned/reused servers still work; stale, missing, failed or redirected provenance refuses. The check honors `TRAIL_DIST_DIR`. It verifies server identity, while `audit:dist` and the smoke suites retain content/hash/public-approval checks.

## Built-artifact mode preflight

The built-artifact Playwright configuration also checks `dist/provenance.json` (or the same `TRAIL_DIST_DIR` override selected by the artifact server) before starting its server or browser. Test expectations must match its dataset kind and estimated-connection flag. The default is fixture/strict; county requires `TRAIL_EXPECT_DATASET=county`, and an owner-private artifact additionally requires `TRAIL_ASSUME_ESTIMATED_CONNECTIONS=1`. A mismatch, unknown flag, or missing/malformed mode evidence fails immediately with the artifact's expected flags. Rebuild if a different artifact mode was intended. This checks test selection only; `audit:dist` still verifies artifact hashes and public-release eligibility, and matching private-mode tests do not authorize a public release.
