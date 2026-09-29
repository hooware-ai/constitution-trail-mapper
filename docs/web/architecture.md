# Browser architecture decision

The established route-to-ride design log remains authoritative. The web app follows Plan → planner → full route preview → navigation, with distinct Saved and Recent data. Its green trail / blue access / orange closure / purple proposed visual system comes from that log. Responsive layouts use a map and side panel on wide screens and a map above rider controls on phones. Native entry points and Compose UI remain intact.

## Shared code

The sharedLogic module contains existing pure Kotlin routing/domain sources, preserving their packages. Android and iOS continue to consume them through shared, whose dependency is exported through its framework. Existing routing tests travel with the code and run on JVM and JavaScript; UI/store tests stay in shared.

The webBridge module exposes one JSON command boundary as an ES module. The browser worker imports it. Dataset parsing, graph building, route search, closures, directions, matching and rerouting run in the worker, leaving the UI responsive. JSON transport avoids exposing Kotlin implementation objects as web application state.

## Technology choice

Kotlin/JS officially supports sharing Android/iOS/web logic and ES modules:
https://kotlinlang.org/docs/js-overview.html

Kotlin/Wasm is a viable future option and can offer performance advantages, but requires WasmGC/exception handling support and raises the browser minimum (for example Safari 18.2+, Chrome 119+, Firefox 120+):
https://kotlinlang.org/docs/wasm-configuration.html
https://kotlinlang.org/docs/wasm-overview.html

For this first entry point, Kotlin/JS preserves the routing core while React DOM supplies semantic controls, keyboard focus and browser layout, and Leaflet supplies a mature interaction layer:
https://leafletjs.com/reference

This choice is based on compatibility and straightforward platform integration. No benchmark claim that JavaScript is faster than Wasm is made. UI parity does not require compiling native Compose UI into the browser.

## Platform boundaries

- core.ts / worker.ts: asynchronous Kotlin bridge and error propagation.
- MapView.tsx: geometry rendering, map point selection, fit/zoom and optional normal online OSM tiles. It never caches tiles for offline use.
- platform/navigation.ts: foreground lifecycle, fresh-fix gate, in-flight result invalidation and local recovery; Kotlin supplies route decisions.
- platform/wakeLock.ts: feature detection, rejection/release handling and visibility reacquisition.
- platform/storage.ts: versioned browser library and active-ride state, retention, corruption/quota reporting.
- platform/sharing.ts: summary privacy and explicit attributed route export.
- search.ts: local landmark search and proximity ranking. A future geocoder must replace this adapter without treating typed text as resolved coordinates.

Only secure contexts can supply location/wake-lock capabilities. Localhost is suitable for development; physical-phone acceptance needs HTTPS:
https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API

Location/wake-lock integration cannot guarantee background execution. Page visibility, pagehide/pageshow, stale readings and lost fixes deliberately remove stale maneuver guidance. Ridden distance is separate from current route position so reacquisition cannot invent a traveled track.
