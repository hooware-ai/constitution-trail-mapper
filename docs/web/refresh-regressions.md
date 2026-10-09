# Current-source refresh regressions (#108)

This slice makes the existing offline foundations reproducible and gates the existing
runtime controls in CI. It changes no application entry point, source execution,
scheduler, endpoint, approval, sharing, native feature or public-launch decision.
Private v12 remains the accepted application release.

## Genuine producer and admission chain

The fixture generator pins the reviewed detector and durable state wrapper from main
`452eccc0fc1016f0012c923e3a4d4b45de8e3c24`. This commit label records the reviewed origin; the two file digests are the executable integrity pins. Verification imports an isolated copy of only those two pinned modules. The detector digest is
`10da2ac2d74b0a08d317328aba0c23786e60dce5f6cda5b57af1235ed94a1743` and the
state-wrapper digest is `33183e194d50a3ada5f1ea99ac2732218905b0387952903b202258e07061ed5d`.
Both guards remain mandatory. The verifier regenerates twice, compares exact bytes
to the committed fixture, and proves a change to either producer is refused before
output. All transport bytes are self-authored; no URL is fetched or source enabled.
The prior PR109 producer/fixture is retained in Git history as the compatibility baseline.

`refresh-chain.test.mjs` consumes the genuine Python A→B→A/current-diff journal through
strict admission with no synthetic-provenance bypass, actual compatible-core router
controls, immutable artifact verification, rollback-ledger retrieval and offline
runtime binding. Missing source records preserve the complete compiled exclusions.
Stale/tampered evidence, changed immutable artifacts, substituted whole-ledger hashes
and unapproved runtime history fail closed. Original history is retained.

The approved dataset lane uses only an explicitly self-authored test package with its
matching synthetic composition. It reads no private county package and grants no
production approval. Fixture sequence 41→45 is not a Site version or assigned issuer.
An independently reviewed synthetic removal proves the whole-ledger supersession
maps to the compiled-descriptor hash. Its desired future catalog is a fixture,
**not a rebuilt target core**: actual unchanged-core admission refuses that removal.
The binding remains `approved:false` and `activationAllowed:false`.

## Reproduce from a clean selected checkout

Use the documented JDK21/Android SDK/Node24 checkout setup and provisioned Playwright
browsers. Regeneration is POSIX-only because the real Python state wrapper uses `fcntl`.
The ordinary JavaScript tests consume the committed fixture without spawning Python.

```sh
python3 webApp/tests/support/verify-detector-admission-fixture.py
cd webApp
npm ci
npm run build:core
npm run typecheck
npm run format:check
npm test
export TRAIL_RUNTIME_EXPECT_COMMIT="$(git rev-parse HEAD)"
node tools/run-runtime-controls.mjs runtime-chromium
node tools/run-runtime-controls.mjs runtime-webkit
```

Use `PLAYWRIGHT_BROWSERS_PATH` when browsers are provisioned in a shared cache.
An explicit safe `TRAIL_TEST_PORT` may be set; the server owns its port and is never reused.
No filtering/retry option is accepted by the runner. Expected failures include wrong
selected commit, dirty source, changed/missing core, changed producer pins and any
failed/skipped/flaky browser control. Each engine must pass all 16 existing controls;
future additions need an explicit count update.

## Hosted evidence and limits

`.github/workflows/web-refresh-regressions.yml` is read-only, secret-free CI on PR/push
events, with no scheduled trigger or deploy. Each Chromium/WebKit job checks out the
exact PR head (or selected push/manual SHA), regenerates the producer fixture, builds
its own core and runs the chain plus all 16 existing runtime controls. The strict
runner verifies the selected clean source and core before and after the browsers,
records full reports with digests under `dist-report/runtime-controls`, and refuses
skips, retries, flaky passes, global errors or incomplete results. Existing release,
WebKit, replay and applicable Firestore gates retain their original checkout behavior.

These runtime controls use the existing Vite fixture harness, actual App/controller
and module workers. Existing built-artifact release controls are separate; this is
neither an enabled-runtime production-artifact certification nor physical GPS/device
acceptance. Production still needs authoritative sequence/history/bootstrap and
supported client-floor bridges, admitted data/source/provider policies, an approved
endpoint and explicit activation; private v12's unapproved county record is not a
runtime bootstrap. Source scheduling/alerts and public/physical acceptance remain
separate decisions. Passing this development gate does not activate any of them.
