# Private estimated-connections TEST MODE (default OFF; review builds only)

Recorded 2026-10-04. **This approves nothing and is not a release.** The dataset stays `approved:false` and `publicRelease.allowed:false`. It exists so the owner can try the real map privately when a route's road-to-trail or endpoint connection is only ESTIMATED.

## What it does

A route that contains estimated (unverified) access connections may Start, resume, take GPS snapshots, be inspected, saved, recalculated and (for loops) reversed, provided every OTHER gate passes. Nothing about the connection is changed: it stays an unrouted segment in the route, stays in `accessGaps` with its measured length, is drawn and listed as an unverified connection, is exported as endpoints only, and the gap count is never reduced. The route description says the assumption is in force (`assumedConnections: true` and a `PRIVATE TEST MODE: ... Verify the actual connection before riding.` warning), the page shows a build-level banner, and a note sits beside Start.

## How it is switched on

Only at build time: `TRAIL_ASSUME_ESTIMATED_CONNECTIONS=1` with the review channel (a public-channel build refuses). It becomes `__TRAIL_ASSUME_ESTIMATED__`, and the worker passes `assumeEstimatedConnections` in the `initialize` request to the Kotlin bridge, which holds it until the next initialize resets it to false. It is not a URL parameter, a setting, a stored value, or `trustSerializedRoutes`. `provenance.json` records `build.assumeEstimatedConnections` and adds the public-release blocker "built in the private test mode ...", recomputed on verification, so editing the flag out of the record fails the audit.

## What it does not do

Known active closures, stale or changed routes, Proposed trails, network identity checks and the rest of the Start rules are untouched (`canNavigate` differs from the strict build only in the estimated-gap term). A saved route opened in a default build is recomputed there and is blocked again if its connection is still unverified, because the gap is a property of the route's segments, not of what was saved. A pair with no candidate path still gets no route.

## Evidence (local; synthetic and real data)

- Kotlin bridge tests (JVM and JS, 57 each): strict vs on for the same gapped route (same gaps, segments, route and distance; only `canNavigate`, `assumedConnections` and one warning differ), reset by the next initialize and not implied by `trustSerializedRoutes`, Proposed and stale networks still blocked, snapshot refused strict and accepted in test mode.
- Provenance test: flag recorded, release blocked, edit-out refused. Browser spec `tests/e2e/estimated-test-mode.spec.ts`: the default build shows no banner and Start stays disabled; the test-mode build shows the banner and warning, still lists the 365 ft connection and the unverified-connections map, enables Start, reaches the navigation screen, and the recalculated route can start.
- Real data (the review package, production `AccessLoader`; `release-candidate-logs/estimated-test-mode-20261004/`): all 30 ordered pairs of the six catalog places plan a route, and every one has 4 estimated connections (16 to 132 m in all): strict build blocks Start for all 30; test mode allows all 30 with the identical route, `inspect`, GPS snapshot and recalculation. The catalog markers are off-trail points, so none of these pairs is gap-free. A 3 mile loop from Tipton Park (4 connections, 75 m) behaves the same including reverse. Willow: the gap-free 97 to 98 leg is Start-eligible before activation and blocked at activation in both modes; a route with 4 connections across Willow is blocked at activation in test mode too. Points far outside the network give "No safe route" in both modes (no route is invented).

## Limits

Test mode assumes only what the graph already proposes; it never creates access. It cannot make a route where the graph has no candidate. It does not verify any connection, and a rider must. The routes above are Start-eligible only in the private test-mode build.
