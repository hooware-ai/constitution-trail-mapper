# Portable trip replay gate

`npm run test:trip:fast` is a small, deterministic navigation gate for a fresh checkout. It builds this checkout's Kotlin web bridge, runs synthetic closure/Start controls through the real router, then replays scripted browser trips on desktop Chromium and a Pixel-sized Chromium profile. The browser replaces only geolocation, page visibility and wake-lock APIs; the app, worker, route matching and saved-ride code are real. No private county extract, account, external map service, device or credential is required. External requests are blocked in the replay tests.

The replay table in `webApp/tests/replay/trip-replay.spec.ts` covers:

1. An ordinary corner: progress and observed distance increase with successive 20 m fixes.
2. An out-and-back return leg: the repeated line does not rewind to its outbound pass, including after reload.
3. Coarse and lost fixes, recovery, hiding/showing the page and reload: stale guidance stays hidden until a fresh fix.
4. Sustained departure: one stray fix does not reroute; confirmed off-route status offers a mapped replacement and guidance resumes only after a fresh fix.

The fast gate also runs `bridge-closures.test.ts`: the synthetic Uptown closed-trail crossing blocks Start and cannot be used as a detour, while the Hamilton road advisory informs without blocking. `npm run test:trip:deep` runs that same fast gate followed by `release:check` (larger browser, synthetic county-package, built-artifact and timed Willow/Camelback controls) and `test:webkit`. CI runs the fast gate on PRs; `.github/workflows/web-trip-replay.yml` also offers a manually selected deep lane. The standalone release, WebKit and Firestore-rules workflows remain independent PR evidence. Both trip-replay lanes are fixture-only and non-deploying.

For a local fresh checkout, use Node 24, JDK 21, an Android SDK path for Gradle configuration, and `npm ci` in `webApp/`; the fast command builds the bridge. Install Chromium with `npx playwright install chromium` if needed. The workflow does these setup steps on its runner and uploads failure traces. The same commands can be used in a saved cloud environment once its package/network settings are approved; no cloud environment or credentials are created by this gate.

These tests do not establish GPS sensor quality, OS permission behavior, screen-lock behavior, turn prompts outdoors, Android/iPhone Safari behavior, VoiceOver/TalkBack or physical-device acceptance. The real-data native audits additionally need the ignored, hash-pinned county/OSM/access extracts; the synthetic replay deliberately has no dependency on them.
