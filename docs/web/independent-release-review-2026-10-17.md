# Independent release review - 2026-10-17

`7c118c33ed080f2b0b8349a1efeb76ed2a0a0b42` must not be released unchanged. A separate reviewer read the actual commit, reproduced two regressions against its compiled Kotlin/JS core, added regressions, and re-reviewed the corrections in this follow-up change.

## Findings and repairs

1. **Estimated connectors could bypass modeled closures.** Camelback required both full connector endpoints to lie within 0.5 m of its source line. A start 0.6 m off that line produced a connector passing approximately 0.2 m from the closed crossing but remained navigable. A Willow connector with an endpoint 19 m off-line likewise traversed its closed interval while escaping the full-endpoint check.
   - Estimated crossings now use distance to the finite connector at the existing closed crossing, the existing 3 m tolerance, and existing longitudinal alignment.
   - Estimated interval travel requires positive projected overlap and proximity to the finite closed section within the existing 15 m graph reach. Distant endpoints no longer hide travel near the closure. Uptown uses its existing curved polyline, never an invented endpoint chord.
   - Mapped travel gates, perpendicular-road controls, closure dates and raw route geometry remain unchanged.
2. **Component-first snap selection could discard useful nearby alternatives.** In the reviewer's hairpin fixture, adding six unrelated road fragments evicted a 17 m connection and changed a 350.6 m trip into a 4,131.2 m trip.
   - Preserve the original nearest N eligible candidates. Append at most N candidates from previously unrepresented components (default maximum eight total).
   - The crowded-component recovery remains, while the original hairpin alternative is retained in both directions. No snap-distance, path-eligibility or graph-join changes were made.

The reviewer found no further actionable regression in the bounded directions/storage review. The prior storage-failure repairs and connector instructions remain covered. The obsolete built-county test expecting estimated connections to disable Start now checks enabled Start and the ride screen without a private override.

## Evidence

All paths below are local, ignored evidence files unless described as source tests.

| Check                                                                              | Result                                                                                      | Evidence                                                                                                  |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Independent reviewer JVM selection                                                 | 93 passed                                                                                   | `independent-review-jvm-final.log`                                                                        |
| Lead affected shared + full bridge JVM selection                                   | 123 passed: snapping 6, estimated closures 5, timed closures 30, instructions 15, bridge 67 | `final-review-correction-jvm.log`                                                                         |
| Full web unit suite on corrected Kotlin/JS core                                    | 733 passed, 5 skipped                                                                       | `webApp/output/reliability/review-unit.log`                                                               |
| Connector and selective storage-failure browser checks, Chromium desktop + Pixel 7 | 16 passed, 4 private-mode cases skipped                                                     | `webApp/output/reliability/review-browser.log`                                                            |
| GPS trip replay, desktop + Pixel 7                                                 | 10 passed                                                                                   | `webApp/output/reliability/review-replay.log`                                                             |
| Actual compiled-core independent reproductions                                     | Closure bypasses refused; hairpin stays 350.6 m with and without unrelated fragments        | `webApp/output/reliability/crossing-offset-fixed.log`, `willow-offset-fixed.log`, `snap-detour-fixed.log` |

The corrected core input hash begins `9c42720069b9`; output begins `48eb5c26fddb`. Build, provenance and artifact audits must be repeated for the exact clean follow-up commit and again for any later merge commit. Do not deploy the earlier synthetic `dist/` fixture artifact.

## Verified live target and minimal release plan

Read-only Sites metadata and public provenance identify the current target:

- Project `appgprj_6ac1b9a1cc208191b0154b2ddc459e74`, public audience, https://constitution-trail-mapper.hooware.chatgpt.site.
- Live version 42, saved version `appgprj_6ac1b9a1cc208191b0154b2ddc459e74~appgver_2ef5932db69081919415530f6b4b09f4`, succeeded deployment `appgdep_6aceed6b04b08191a2c62b38711f48fe`.
- Sites source commit `51559e308fb1dea29eec2c7d779abfc0cbd4fa8a`; its app provenance identifies application commit `783f2f5f48eb1beaeee4963ed53b186d6e126adf`.
- Live app files hash `d468badc9a0e95ae92e5fcfe4be6cc2567d63a7e011cc25d7ee973ff2d880b7a`.
- County network stays `903e43cf077acf79988920eb114b02e0f90bab022180aca88f5205c7a1ed882d`; address index stays `e41bd334bab3edbe19a4a4547149e9d390f2842dcba9a3a83ee8aa47bb950841`.

For local public-candidate preparation, all 445 live static data files (7,526,658 bytes) were hash-verified. The existing committed county/OSM/access manifests and address pin still govern admission; no new data was approved. Windows CRLF checkout bytes initially failed raw manifest pins. Only those three manifest files were restored to their exact Git blob bytes after proving the difference was line endings alone. The unchanged strict county verifier then passed with 258 approved features.

After release authorization:

1. Push the reviewed application branch through normal PR/CI review and merge. Rebuild from that exact clean merge; `npm run build:public` uses the existing approved county package and keeps the private override off. Verify the core and public provenance, then run the built-artifact county smoke/real-route checks.
2. Update the existing Sites source with the exact resulting app artifact. `index.html`, `provenance.json`, and the newly hashed app/routing-worker/import-dependent RideMap JavaScript need replacement. CSS, icons, map worker and approved data should remain byte-identical unless the artifact comparison proves otherwise. Do not publish raw Kotlin output or the fixture network. Preserve the existing hosting manifest, serving wrapper, audience, storage bindings and support endpoint; the existing Worker staging flow places app files in `public/` and moves its entry HTML to `trail.html`.
3. Push/package that exact Sites source state, save its matching archive as a new version of the same project, then deploy only that saved version. Keep version 42 and its immutable assets available for rollback/open tabs.
4. Read back the live app commit/core/files hash and changed asset bytes; check ordinary estimated-access Start, a known closure refusal, reload and saved-ride recovery before announcing the version live.

No push, merge, saved Site version, deployment, access-policy change or public record write was performed in this review. Sites source opening was attempted read-only with its supported helper; Windows terminal/stdin opening failed before a checkout was populated. Existing Site identity/version and public artifact bytes were independently readable. Source synchronization/publication remains a later operation in a working Sites execution context.
