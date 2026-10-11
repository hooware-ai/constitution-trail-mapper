# Endpoint recovery — October 11, 2026

The owner reported that live v27 could not obtain location, select a map point, or search addresses. This work prepares fixes; it does not deploy or change sharing. Native features and PR136 remain separate.

Fresh anonymous live-browser reproduction confirmed two map failures: a closure marker consumes a selection tap, and the picker instructions cover the map center at 360×640. Point-picking controls now have space outside the canvas. Closure geometry and symbols stay visible while selection owns canvas taps; normal closure details remain interactive outside point-picking. Tests use actual Kotlin map-point resolution.

The public build deliberately omitted the existing county address index. The owner requested working address search; public county artifacts now include a pinned index, loaded only when a house number and street are typed. Search runs locally and never sends typed text or device position to a geocoder. No new service, account, paid usage, or sharing is introduced. The chooser carries attribution, changes, ambiguity and staleness information. Address points do not establish trail entrances: unverified connections still block Start.

The October 11 complete unauthenticated county download returned 85,220 rows and distinct IDs with no transfer-limit truncation. The deterministic transform retains 85,075 points. The committed pin records the fresh source, license, completeness and index hash. This snapshot differs from October 3; the currentness of every address remains unknown. Run `npm run prepare:addresses` before `npm run build:public`. Preparation refuses changed raw/index bytes and never updates a pin automatically. Generated address files remain ignored.

Fresh live browser tests exercise scripted location denial and successful retry, but do not explain the owner's physical-device failure. A coarse position currently cannot be selected until it meets the navigation accuracy threshold. An explicit option now permits a fresh approximate position for planning, with its uncertainty in the endpoint label. It does not weaken navigation's 35m accuracy requirement. Old and late callbacks cannot replace a selected position; expired approximate readings are rejected. Permission, unsupported-provider and timeout recovery remain available.

No service worker is registered by the current app. A fresh live page booted without page errors or failed asset requests; this does not prove an older browser profile or embedded browser is healthy. Existing hash-named assets and revalidated dataset requests remain in place; no browser data is deleted and no stale-worker workaround is assumed.

Physical acceptance is blocked: the separate Windows task received EACCES on the existing ADB endpoint 127.0.0.1:5037 and DroidDock endpoint 127.0.0.1:3210. It verified no device actions. Cloud browser emulation and scripted location are not physical GPS, OS permissions, or phone acceptance.

Deployment remains held after the parent's safeguard rejection, even after the reported public-site approval. Do not retry through another route; deliver the verified artifact and provenance for the parent to resolve publication.
