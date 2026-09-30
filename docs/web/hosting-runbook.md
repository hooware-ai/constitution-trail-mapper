# Web hosting runbook (draft for approval)

Status: **preparation only.** No provider is chosen, no resource exists, no origin is configured and nothing is public. This runbook says what any static host must do for this app, how a release is identified and rolled back, and which choices are still open. Creating a resource, buying a service or publishing a preview is a separate, explicit authorization. The current artifact is the fixture-only review build (see [release.md](release.md)); it must not be published as a real product.

## What is deployed

A static directory, `webApp/dist/`, produced by `npm run release:check`: `index.html`, hashed files under `assets/` (the app bundle, CSS, and the routing **module worker**), a small web manifest and icon, and `provenance.json`. There is no server code, no server-side storage and no analytics or tracking. The routing engine runs in the visitor's browser; the fixture network is bundled into the worker. (The real dataset's delivery is decided under #47: bundled asset versus separately hosted, hashed file. Either way its identity is recorded in `provenance.json`.)

## Required response headers

The exact policy lives in `webApp/hosting/headers.mjs`; `tools/serve-dist.mjs` sends it and the smoke tests in `tests/dist` run against it (fresh load, worker start, no CSP violations, no foreign requests). Map it 1:1 onto the chosen host.

| Header | Value / intent |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'`; scripts and styles from `'self'` only (inline style *attributes* allowed for React/Leaflet); `img-src 'self' data: blob: https://tile.openstreetmap.org`; `connect-src 'self'` plus, later, the auth/sync origins decided under #31-#33; `worker-src 'self' blob:`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; `frame-ancestors 'none'`; add `upgrade-insecure-requests` on HTTPS |
| `Referrer-Policy` | `strict-origin-when-cross-origin` - **not** `no-referrer`: the OpenStreetMap tile policy requires a valid Referer |
| `X-Content-Type-Options` | `nosniff` |
| `Permissions-Policy` | `geolocation=(self)`; camera, microphone, payment, usb, bluetooth and serial explicitly disabled (other features keep the browser default) |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` (a stricter value would break popup sign-in in #32) |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` on the HTTPS origin only (never send it over HTTP); preload only after the domain decision below |

If the chosen host cannot set one of these, that is a finding to resolve before use, not a reason to drop it. This set is sufficient for the fixture-scope app and is **not** an authentication certification: the real auth, frame and connect origins are added under #31-#33 when they are known, without speculative broadening.

## HTTPS, assets and caching

- HTTPS only, with HTTP redirected. Browser geolocation and service-worker-style APIs require a secure context (the app already refuses to request location on an insecure page).
- `assets/*` are content-hashed: `Cache-Control: public, max-age=31536000, immutable`.
- `index.html`, `provenance.json`, `manifest.webmanifest` and anything else that names hashed files: `Cache-Control: no-cache` (revalidate every load) so a new release is picked up immediately and a rollback is not masked by a cache.
- `.js`/`.mjs` must be served as `text/javascript`. The worker is a same-origin **module** worker; a wrong MIME type or a cross-origin worker URL breaks routing.
- Missing files under `/assets/` must be a real `404` (never the HTML shell) so a bad deploy fails loudly. Unknown *page* URLs may fall back to `index.html` (the app is a single page).
- No offline area download or tile prefetch exists and none should be added by a host or service worker.

## Errors and fallback behavior

If the worker asset cannot be fetched or fails to start, the app shows "Trails could not load" with **Retry loading** (smoke-tested with the asset blocked, then recovered). A real-data load failure must stay visible and never silently route on fixtures (documented in the README; covered in the app tests, and to be re-verified against the real dataset under #47). A routing-worker crash after load offers **Restart route planning**. There is no server to fail: outage means the static host is unavailable.

## Release identification

Every artifact carries `provenance.json` at its root: source commit, whether the tree was clean, Kotlin core input/output hashes, dataset identity (`kind`, `id`, `version`, `approved`, content hash) and the SHA-256 of every file, plus `publicRelease.allowed/blockers`. To identify what is live: fetch `/provenance.json` and compare `source.commit` and `filesSha256` with the release you intended. `node tools/audit-dist.mjs` recomputes all hashes for a local `dist/`. Record the commit, `filesSha256` and dataset version in the release notes for each deploy.

## Rollback

Keep the previous artifact directories (or the host's previous deployment) addressable by their `filesSha256`.

1. Redeploy the previous artifact (or promote the host's previous deployment).
2. Confirm `/provenance.json` shows the previous commit and `filesSha256`; confirm `index.html` is revalidated (a hard refresh must not be needed).
3. Users with the new page open keep their loaded assets until reload: hashed assets are immutable and both versions must remain available for at least the cache lifetime, so **do not delete the newer release's assets when rolling back**.
4. Saved data lives in each visitor's browser (and, once #31-#33 land, in the cloud project): a rollback must never change a stored-data schema without a versioned migration.

## Basemap

The optional basemap requests `https://tile.openstreetmap.org/{z}/{x}/{y}.png` only after the rider turns it on. The public OSM tile service is best-effort, has no service guarantee, forbids bulk/offline use and can withdraw access; see [data-rights.md](data-rights.md) and the [official policy](https://operations.osmfoundation.org/policies/tiles/). Required regardless of provider: visible linked attribution, a valid Referer, honoring cache headers (seven days minimum if unknown), no prefetch or harvesting, and no automated test traffic (tests stub or disable tiles). A dependable public launch needs a provider arrangement sized to real use; that is an open choice below.

## Measured startup (emulated, not physical)

`npm run measure:dist` serves the built `dist/` with the production headers **and gzip/brotli compression** (as a real host would), then loads it on a Pixel 7 profile with a 4x CPU slowdown and a 1.6 Mbps / 150 ms RTT connection, cold cache, five runs. Recorded 2026-09-30 on the fixture-only artifact of this change (medians):

| Measure | Result |
| --- | --- |
| Static weight, uncompressed / gzip / brotli | 976 KB / 293 KB / 243 KB (6 files; the routing worker 494 KB raw / 117 KB brotli and the app bundle 450 KB raw / 116 KB brotli dominate) |
| DOMContentLoaded | 1.8 s |
| App usable ("Go somewhere" shown after routing data loads) | 4.0 s |
| First point-to-point route plan after choosing both ends | 0.16 s |

These are **emulator numbers on the small synthetic network**. The real dataset is larger and will lengthen worker start-up and the bundle or data download; the CPU slowdown is a rough stand-in for a mid-range phone. They size the work and catch regressions; they do not establish supported behavior. That needs the physical iPhone Safari and Android Chrome runs in #41 against an authorized preview, repeated on the final artifact.

## Outstanding choices

None of these is decided by this change.

| # | Choice | Options to compare | Needed before | Owner |
| --- | --- | --- | --- | --- |
| 1 | Static hosting provider and HTTPS termination | A CDN-backed static host that can set every header above and keep previous deployments (for example Firebase Hosting, since Firebase Auth is already the selected auth path; Cloudflare Pages; Netlify; GitHub Pages if custom headers are not required - it cannot set them, so it likely fails the header table). Compare header control, rollback, preview channels, price and lock-in. | any public preview | Jesse (account/spend) after engineering comparison |
| 2 | Origin and domain | Custom domain versus provider subdomain; HSTS preload only after the domain is final; authorized domains for sign-in (#32) must match | first HTTPS preview | Jesse |
| 3 | Basemap delivery | Keep public OSM tiles (only for tiny, human-driven use), a paid tile provider with a domain-restricted key and billing cap, self-hosted tiles, or no basemap (trail geometry only). Needs expected requests per rider and monthly cap | any launch beyond a handful of testers | Jesse for spend; engineering for sizing |
| 4 | Real dataset delivery | Bundled with the worker (larger first load) versus a separate hashed file fetched once; approved composition and license notices | #47 | owner decision on rights, engineering on delivery |
| 5 | Preview audience and access | Private link, allow-listed testers, or public; feature flags (sign-in off until #32) | first real-device test (#41) | Jesse |
| 6 | Sign-in origins | Firebase project/environment per stage, Google and Apple registration and callback URLs, authorized domains | #32 | Jesse for accounts/credentials; engineering for configuration |
| 7 | Error visibility | None today (no analytics by design). Decide whether to add voluntary feedback (#72) before launch | launch | Jesse |
| 8 | Capacity and cost assumptions | Static bytes per cold load are measured above; request/egress cost depends on the provider and expected riders per day | provider selection | engineering to compute once #1 and #3 are chosen |

## Pre-release checklist (per deploy)

1. `npm run release:check` passes on the exact commit; CI is green on that commit.
2. `dist/provenance.json`: `publicRelease.allowed` is `true` (approved dataset, clean tree); otherwise the deploy must be labelled a private review build.
3. Headers verified on the live origin (a header scan matches the table).
4. Physical iPhone Safari and Android Chrome acceptance (#41) run against the live artifact, then repeated on the final candidate.
5. Rollback target recorded (previous `filesSha256`).
