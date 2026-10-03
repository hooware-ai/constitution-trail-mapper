# Trail Mapper web review

The web entry point is separate from Android and iOS. It renders a semantic React interface and Leaflet map. A dedicated browser worker calls the same Kotlin routing code used by native applications. No JavaScript router or duplicated graph policy exists.

## Local run

Prerequisites: JDK 21, Android SDK (Gradle still configures native modules), Node 22.12+ or 24, npm, and the existing Gradle wrapper. No map key or account is required.

From the repository root:

    ./gradlew :webBridge:jsBrowserProductionLibraryDistribution
    cd webApp
    npm ci
    npm run dev

Open http://127.0.0.1:4173. This loads a self-authored synthetic network. It is visibly labeled and **must not be used for a real ride**. Use “Review trailhead · East” and “Review trailhead · South” for a working route, or create exercise loops.

For an actual local network, first generate the three ignored assets using the existing README. Set TRAIL_LOCAL_DATA_DIR to the absolute data/generated directory before starting Vite:

    $env:TRAIL_LOCAL_DATA_DIR = (Resolve-Path ../data/generated).Path
    npm run dev

Open http://127.0.0.1:4173/?data=local. The endpoint exists only in the Vite development server, checks the connection is loopback, and sends Cache-Control: no-store. It is absent from the static distribution. The app binds to loopback by default. Do not expose this local review server publicly.

A local-data error fails visibly; it never silently routes on fixtures. Synthetic and real-data libraries use separate browser storage namespaces.

## Build and checks

The reproducible clean-source path is `cd webApp && npm run release:check`; see [release.md](release.md) for what it runs, its provenance record and the stale-core protection, and [hosting-runbook.md](hosting-runbook.md) for header, caching, rollback and the still-open hosting choices. The manual commands below still work; `npm run build` now verifies the Kotlin core manifest first.

    ./gradlew :sharedLogic:jvmTest :sharedLogic:jsNodeTest :webBridge:jvmTest :webBridge:jsNodeTest :shared:testAndroidHostTest
    ./gradlew :androidApp:assembleDebug :androidApp:lintDebug
    cd webApp
    npm run build:core
    npm run typecheck
    npm test
    npm run test:e2e
    npm run build

Real-data JVM tests require the ignored generated assets. How the open web stack relates to native `main`, and the no-mutation integration checklist, is in [integration-handoff.md](integration-handoff.md). The local combined-tree release-candidate results (not a shared merge or release) are in [release-candidate-verification.md](release-candidate-verification.md). The October 2026 dated closure and advisory work (sources re-fetched, exact instants, the approximate Willow mapping, the Camelback crossing blocker, and the Saved route and Recalculate flow) is in [closure-readiness.md](closure-readiness.md). The native-to-web data, routing and feature parity matrix, its evidence and the implementation plan are in [native-parity.md](native-parity.md). Automated WebKit coverage of the first-visit journey (`npm run test:webkit`, after `npx playwright install webkit`) and the operator checklist for physical Android Chrome and iPhone Safari are in [launch-acceptance.md](launch-acceptance.md); WebKit here is Playwright's engine build, not a device. Browser tests use synthetic data and simulated location; no map tiles or private locations are needed. Build output, node_modules, test traces, routing assets and local configuration are ignored. The production build includes a publication-sensitive content scan and produces a fixture-only static directory.

iOS compilation and execution require macOS/Xcode. Windows Gradle metadata or JVM checks cannot establish iOS runtime acceptance.

## Product and limitations

- Point-to-point rides and exercise loops use existing 3, 5, 10 and 15 mile presets plus custom 0.5–100 mi targets.
- Place search uses a small local catalog, saved places, and map selection. It does not claim a complete geocoder or send search text to a third party. Destination proximity uses resolved Start; otherwise the Bloomington–Normal center is used.
- Routing, closure matching, hazard weighting, proposed opt-in, exercise behavior, maneuvers, matching and safe rerouting come from Kotlin.
- Saved routes/places remain in this browser. Recent routes are limited to 20 for 30 days from last use; saving removes the recent copy. No account or sync is provided.
- Every reopened route is checked against the current bundled closure/advisory catalog before navigation. The UI calls this a catalog check, never a live all-clear. Official-source links and review dates remain visible. Updating reviewed notices is still a release/maintenance responsibility.
- Navigation is foreground only. Hiding or locking invalidates guidance; reopening or reloading requires fresh location. Fixes older than 15 seconds, more than 35 m accuracy, or implausibly future-dated cannot guide. Unobserved travel is never credited as ridden distance.
- Wake lock is optional and reported as held, released, denied or unsupported. No background or screen-off navigation promise is made.
- No offline area download or tile prefetch is implemented. Loaded geometry can keep working in the open page during network loss, but reload/browser eviction without network is not guaranteed. The app explicitly does **not** claim offline navigation.
- Privacy-default sharing includes a summary without exact endpoints or private labels. Exact route file export requires an explicit choice and carries attribution.
- Home-screen installation is optional through the browser. The manifest is not evidence of offline capability.

## Release gate

No site has been publicly deployed. Read [data-rights.md](data-rights.md). The separate licensed extractor establishes a CC BY path for 254 existing county features, but is not a deployment approval. The six proposed geometries need their own redistribution basis or must remain omitted from public assets. OSM-derived graph obligations, provider terms and operational suitability must be resolved before releasing real data. If a commercial map/search provider is added, use properly restricted browser keys, billing limits and compliant attribution; credentials never belong in Git.

Before production use: review current official closure notices, validate the chosen real dataset and routing behavior, complete physical Android Chrome and iPhone Safari interruption tests over HTTPS, verify assistive-technology navigation, and obtain the owner's explicit deployment approval.

See [verification.md](verification.md) for executed checks, results and exact device acceptance gaps, and [place-catalog.md](place-catalog.md) for the small search catalog's authoritative sources.
