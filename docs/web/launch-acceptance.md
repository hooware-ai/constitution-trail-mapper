# Launch acceptance: automated WebKit coverage, candidate matrix and operator device checklist (issue #41)

**This is groundwork, not acceptance and not release authorization.** It adds automated WebKit coverage of the first-visit guest journey, records what each kind of check does and does not prove, and gives an operator the exact checklist for the physical-device runs that remain. Nothing here approves data, hosting, a provider, an origin, sign-in, or a public launch, and **no physical-device result is claimed**: every device cell below is `NOT RUN`.

## What kind of evidence is what

| Label in a test title | What ran                                                                                                                                                   | What it proves                                                              | What it does **not** prove                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `[engine]`            | The real app, routing worker and Kotlin router in **Playwright's build of the Safari engine (WebKit)**, with no device API replaced                        | The app works on the WebKit engine (module worker, storage, layout, focus)  | iPhone Safari, iOS behavior, a physical screen, VoiceOver              |
| `[engine-geo]`        | The engine's own geolocation API fed by the test harness                                                                                                   | The engine's API shape and the app's handling of what it returns            | A GPS, an OS permission prompt, accuracy outdoors                       |
| `[sim-device]`        | A scripted adapter replaces `navigator.geolocation`, page visibility and the Wake Lock API so each interruption happens exactly when the test says         | What the **app** does when a browser reports that event                     | What iOS or Android actually report, or when                            |

Playwright's `iPhone 15` and `iPhone SE` profiles set the viewport, touch and user agent. They are **not** a phone. Run them with `cd webApp && npx playwright install webkit && npm run test:webkit`; the existing Chromium suites (`npm run test:e2e`, `playwright.config.ts`) are unchanged and run separately. The hosted job is `.github/workflows/web-webkit.yml` (**Web WebKit launch acceptance**): its own workflow, a 40 minute cap, no secrets, no deployment, and not a required check (making it one is an administrator decision, as for the other checks).

## Automated coverage of the first-visit guest journey

`webApp/tests/webkit/` runs on three profiles: `webkit-desktop` (Desktop Safari), `webkit-iphone` (iPhone 15) and `webkit-iphone-se` (320 pt wide). Chromium columns refer to the existing suites in `webApp/tests/e2e/` (desktop Chrome and Pixel 7 emulation).

| Journey step                                                                                  | Chromium suites                         | WebKit specs                                   | Physical device |
| --------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------------------- | --------------- |
| Fresh opening: guest actions, nothing stored, local-only wording, routing worker starts       | `help.spec.ts`, `rider.spec.ts`         | `first-visit` `[engine]`                       | NOT RUN         |
| Explore map, proposed trails off until the rider opts in                                      | `rider.spec.ts`                         | `first-visit` `[engine]`                       | NOT RUN         |
| Point-to-point plan, preview, directions, foreground limit stated at the Start button         | `rider.spec.ts`, `help.spec.ts`         | `first-visit` `[engine]`                       | NOT RUN         |
| Exercise loop validation, plan and preview                                                    | `rider.spec.ts`                         | `first-visit` `[engine]`                       | NOT RUN         |
| Manual planning when location is denied, unavailable or times out; map picker                 | `location.spec.ts`, `rider.spec.ts`     | `first-visit` `[sim-device]`                   | NOT RUN         |
| Current location through the engine's own API                                                 | (adapter only)                          | `first-visit` `[engine-geo]` (see findings)    | NOT RUN         |
| Unverified connection explained at the decision point; navigation blocked; mapped route fine  | `access-connections.spec.ts`            | `first-visit` `[sim-device]`                   | NOT RUN         |
| Save stays in this browser, survives reload; share is private; Help states what leaves        | `rider.spec.ts`, `help.spec.ts`         | `first-visit` `[engine]`                       | NOT RUN         |
| Foreground navigation: wait for a fresh fix, hide/show, stale or inaccurate fixes, reload     | `rider.spec.ts`                         | `interruption` `[sim-device]`                  | NOT RUN         |
| No credit for travel while the page was hidden                                                | `rider.spec.ts`                         | `interruption` `[sim-device]`                  | NOT RUN         |
| Network loss and return; location lost mid-ride; permission denied at start                   | `rider.spec.ts`, `location.spec.ts`     | `interruption` `[sim-device]`                  | NOT RUN         |
| Wake lock granted, refused, absent (older Safari) or taken back; controls stay usable         | unit tests only (`platform-navigation.test.ts`) | `interruption` `[sim-device]`                  | NOT RUN         |
| No claim of background tracking, alerts or recording; the foreground limit is stated          | `help.spec.ts` (states the limit)       | `interruption` `[sim-device]`                  | NOT RUN         |
| No sideways scrolling, off-screen controls, cut-off text or inner scrolling at normal, 150%, 175% and 200% text on the key screens | `rider.spec.ts`, `help.spec.ts` (150%) | `layout` `[engine]` on all three profiles      | NOT RUN         |
| Touch targets of at least 44 CSS pixels for the primary controls                             | (not checked)                           | `layout` `[engine]` on the phone profiles      | NOT RUN         |
| Keyboard completion of the planner, dialog focus return, Escape, browser Back and Forward     | `help.spec.ts`, `rider.spec.ts`         | `layout` `[engine]`                            | NOT RUN         |
| Automated WCAG 2 A/AA checks (axe) on the planner, preview and Help                           | `help.spec.ts`, `access-connections.spec.ts` | `layout` `[engine]`                       | NOT RUN         |
| Closure, proposed-trail and shared-roadway gates                                              | Kotlin bridge tests; `rider.spec.ts` (closure check on reload) | not repeated on WebKit                         | NOT RUN         |

Not covered by any automated suite: real GPS and outdoor accuracy, OS location permission prompts and their settings, lock and unlock, OS eviction of a suspended page, Safari's real wake-lock behavior, real network transitions, home-screen (installed) mode, VoiceOver and TalkBack, performance on the real county data and a real phone, and anything over the intended HTTPS origin. Those are the operator checklist below.

## WebKit findings in this slice

1. **Fixed (web-only, bounded): at larger text the layout scrolled sideways, cut off the header, let the banner cover Help, and scrolled inside its own columns and dialogs.** `webApp/src/styles.css` now: lets the header grow with its text instead of keeping a fixed height; wraps the header, bottom tabs and route actions onto more rows on phones (up to 760 px wide); lets dialog titles and their close buttons wrap; and scales the desktop planner column with the text size (still 340 to 420 px at normal text, capped at about 60% of a narrow window). All are no-ops at normal text size. Regression: `layout.spec.ts` "at 175% / 200% text every key screen fits, nothing is cut off, and controls stay reachable" runs on all three profiles (desktop, iPhone 15, iPhone SE) with no skips. On the tabs, planner, place chooser, map picker, preview, Directions, Share and Help it asserts: no sideways page scrolling, no control off the screen, no cut-off text, **no element that scrolls sideways inside itself** (the planner column, dialogs), the tabs still 44 px or larger on the phone profiles, and the Start button reachable. It fails on the previous CSS (checked: the old column and the old header each fail it). It also runs a **wider-letters variant** (every letter 0.4em wider, which reproduces the overflows the hosted Linux runner's own wider font plus 0.14em, 0.22em and 0.3em produced), because text width depends on the operating system's fonts: the hosted Linux run found overflows (a long single word in a heading, a grid column, a checkbox label, the route-length/time stats row and the place-chooser result rows and the Saved/Recent library tabs) that a Windows run did not. Long words now break instead of widening the page (`body` and headings `overflow-wrap`), the home choice cards and checkbox labels can shrink, the route stats wrap, result rows can shrink, the library tabs, route actions and header brand wrap, long words in buttons, labels and links break, the header's actions can shrink; the layout was also checked once at 0.7em wider letters without changing the 0.4em test, and the page-overflow message names the elements that reach past the edge.
2. **No known layout limit remains at 175% or 200% on these screens**, asserted rather than annotated. Screens not covered (for example active navigation at large text) are on the physical-device checklist.
3. **Harness limit, not an app defect: Playwright's WebKit geolocation provider reports `position.timestamp` in microseconds** (about 1.8e15 against 1.8e12 for milliseconds). The app correctly refuses a fix it cannot date and keeps offering the map picker, so the `[engine-geo]` spec asserts exactly that (and asserts acceptance if a later Playwright reports milliseconds). Whether **real** Safari reports a sane millisecond timestamp is on the operator checklist.
4. **Parity, no defect:** when a place chooser opens, focus lands on its Close button (in Chromium and WebKit alike); Tab reaches the search field. Not changed.

No other WebKit-specific defect was found: the module worker and Kotlin router start, local storage persists across reload, the interruption and recovery behavior matches Chromium, and axe reports no violations.

## Candidate record (fill in for each run; do not reuse an old record)

| Field                                              | Value        |
| -------------------------------------------------- | ------------ |
| Date and tester                                    |              |
| Exact source commit and clean/dirty                |              |
| Artifact (path or deployment) and `filesSha256`    |              |
| Origin (must be the intended HTTPS origin)         |              |
| Dataset kind / id / version / content hash         |              |
| Dataset `approved` (copy from `provenance.json`)   |              |
| `publicRelease.allowed` and blockers               |              |
| Dependency or build configuration changes          |              |
| Device model, OS version                           |              |
| Browser and version (Chrome / Safari), install mode (tab or home screen) |  |
| Screen reader and version (TalkBack / VoiceOver), text size setting |      |
| Network (Wi-Fi, mobile, throttled) and location services setting |        |

## Operator device checklist

Run each row on **physical Android Chrome** and **physical iPhone Safari**, on the exact candidate over its HTTPS origin. Result is one of `PASS`, `FAIL`, `LIMITATION`, `NOT RUN` (the default). Record what you observed, not what the automated suites predict. Keep personal location traces private; record only synthetic or consented, minimized evidence.

| #   | Check                                                                                                         | Android Chrome | iPhone Safari | Notes (observed, defects) |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------- | ------------- | ------------------------- |
| 1   | Origin is HTTPS; the page loads fresh with no stored data; first-visit guest actions are offered              | NOT RUN        | NOT RUN       |                           |
| 2   | Headers on the live origin match `docs/web/hosting-runbook.md` (CSP, Permissions-Policy, no foreign requests) | NOT RUN        | NOT RUN       |                           |
| 3   | Current location: the permission prompt, first acquisition, time to a usable fix                              | NOT RUN        | NOT RUN       |                           |
| 4   | `position.timestamp` is plausible milliseconds (finding 3); accuracy reported outdoors                         | NOT RUN        | NOT RUN       |                           |
| 5   | Location denied, then allowed in settings and retried; unavailable; coarse (approximate) location             | NOT RUN        | NOT RUN       |                           |
| 6   | Manual planning (place search, map picker) works with location off                                            | NOT RUN        | NOT RUN       |                           |
| 7   | Plan point-to-point and an exercise loop; preview, directions, closure and unverified-connection explanations | NOT RUN        | NOT RUN       |                           |
| 8   | Unverified or unsupported route: Start is blocked and reads as blocked, not ready                              | NOT RUN        | NOT RUN       |                           |
| 9   | Start navigation: the foreground requirement is understandable before guidance begins                         | NOT RUN        | NOT RUN       |                           |
| 10  | Screen lock then unlock: guidance pauses, then asks for a fresh fix; no travel credited while locked          | NOT RUN        | NOT RUN       |                           |
| 11  | Switch app / tab and return (background then foreground): same as above                                       | NOT RUN        | NOT RUN       |                           |
| 12  | Browser eviction or reload during a ride (open many tabs, or force-close): the ride resumes only after a fresh fix | NOT RUN   | NOT RUN       |                           |
| 13  | Network loss and return (airplane mode, then back): honest banner, loading and retry; cached saves not presented as offline maps | NOT RUN | NOT RUN |                       |
| 14  | Wake lock: supported or not stated; held while navigating; released when hidden; reacquired on return; denial leaves controls usable | NOT RUN | NOT RUN |              |
| 15  | Repeated segments (an out-and-back or a loop sharing a junction): progress, no rewind, correct pass          | NOT RUN        | NOT RUN       |                           |
| 16  | Guidance after a gap is fresh; none is shown from a stale position                                            | NOT RUN        | NOT RUN       |                           |
| 17  | Saved list, rename, delete and undo; Recent separate; reload keeps saves; saves are described as this browser | NOT RUN        | NOT RUN       |                           |
| 18  | Share and file download behave on the platform; the private option hides exact endpoints                      | NOT RUN        | NOT RUN       |                           |
| 19  | Map selection by touch; map and controls do not trap the page scroll                                          | NOT RUN        | NOT RUN       |                           |
| 20  | Large text (system setting and browser zoom): nothing is cut off or off-screen; note the smallest phone       | NOT RUN        | NOT RUN       |                           |
| 21  | Keyboard (external or switch) where applicable: planner, dialogs, Escape                                      | NOT RUN        | NOT RUN       |                           |
| 22  | Screen reader (TalkBack on Android, VoiceOver on iPhone): planner, preview and its warnings, Start, pause messages, dialogs | NOT RUN | NOT RUN |                      |
| 23  | Home-screen (installed) mode: opens, navigation works in the foreground, and nothing claims native background support | NOT RUN  | NOT RUN       |                           |
| 24  | Mobile load and route response with the **actual release dataset** (`measure:dist` numbers are emulated only) | NOT RUN        | NOT RUN       |                           |
| 25  | Date and exact commit of the run recorded; defects filed with the evidence above                              | NOT RUN        | NOT RUN       |                           |

A `FAIL` or an unsupported capability needs a supported behavior or an explicit product limitation before a public release. iPhone Safari acceptance means the **website** on a physical iPhone; it does not require building or deploying a native iOS app, and a native tooling gap does not waive it. If a device is not available, record `NOT RUN` and why; do not substitute emulation.

## Private pilot versus public launch: gates

Nothing below is approved by this document. A **private pilot** is a limited, labelled preview for named testers; a **public launch** is anything the open internet can reach. A gate stays open until its owner closes it in the place named.

| Gate                                                              | Private pilot                                  | Public launch                 | Where it is decided / current state                                    |
| ----------------------------------------------------------------- | ---------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------- |
| Dataset composition and release approval (`approved`, owner, date)  | Not satisfied; the county candidate is `approved: false` | Required                      | The 254 included county features are explicitly licensed CC BY 4.0; the six excluded proposed geometries and any OSM-derived graph are **future-inclusion questions**, not a missing license for the included subset. The owner's composition and public-release approval remain required. `county-dataset.md`, `data-rights.md`, `webApp/release/dataset.county.json` |
| Physical-device and field acceptance (this checklist)             | Strongly recommended                           | Required                      | #41; every cell above is `NOT RUN`                                     |
| Basemap: OSM tile usage policy and an explicit reliability choice | Comply with the policy (HTTPS URL, visible attribution, valid Referer, honor caching, no bulk or prefetch) | Same, plus an explicit reliability choice | The policy permits compliant browser use, sets no numeric cutoff and does not require a separate provider; availability is best-effort with no SLA, so a public launch decides whether to accept that or use an alternative service. Policy read 2026-10-01; not a legal conclusion. `hosting-runbook.md` (open choice 3) |
| Authorized HTTPS origin, headers, rollback                        | Needed for device runs                         | Required                      | `hosting-runbook.md` (open choices 1, 2); not chosen                   |
| Hosting provider and preview audience                             | Needs a decision                               | Needs a decision              | `hosting-runbook.md` (open choices 1, 5); nothing created              |
| Sign-in and cloud sync                                            | Not built; saves stay in this browser          | Product decision pending      | #31-#33, #51; this slice changes none of it                            |
| Owner's explicit deployment approval                              | Required for any publish                       | Required                      | Owner only                                                             |

The default artifact is the synthetic fixture network and must not be used for a real ride. A county build (`TRAIL_DATASET=county`) is a **review candidate** that can support a private pilot once the gates above for a pilot are closed by the owner; `TRAIL_CHANNEL=public` still refuses it (`data-unapproved`).
