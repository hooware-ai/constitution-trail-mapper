# Public-release readiness: exact v12 data and capability choices

Reviewed October 9, 2026. This is evidence and a proposed implementation, not a
license grant or public-release approval. No sharing, source execution, scheduling
or runtime-refresh activation changed. Native work remains frozen.

## Exact scope and existing compliance

The verified private v12 application is `452eccc0fc1016f0012c923e3a4d4b45de8e3c24`.
Its provenance SHA-256 is
`2356394f3cc354a9c207bd792b46e64f11d0954a7270fa78b2d6b0241a7b068e`.
The dataset is `2026-09-28.1d011563ac84`: 254 county trails, four reviewed OSM
paths, 3,424 TIGER/Line roads and 9,344 OSM service roads. No proposed geometries
are included. PR117 merged as `ba2910041f59eb55e2684e8176b4d56a37e81909` after
five exact-head gates and independent review; its tests/CI/docs do not alter v12.

## Data terms and existing distribution

The included county subset has explicit CC BY 4.0 permission. Its source credit,
license link and change disclosure are already in the dataset, Help and exports.
OSM credit and the linked copyright page match the
[OSMF attribution guidance](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines).
[Census identifies TIGER as public-domain data](https://www.census.gov/newsroom/archives/2014-pr/cb14-208.html).
Noncommercial use and responding to complaints do not waive these terms.

[ODbL sections 4.2–4.6](https://opendatacommons.org/licenses/odbl/1-0/)
include notices and, when derivative-database obligations apply, share-alike and
an offer of the complete database or complete alterations/construction method.
Application code itself is outside the database license. Attribution alone is
therefore not a universal description of the obligations.

This app already distributes all 444 normalized data files: `data/dataset.json`,
`trails.903e43cf077a.json`, `access-base.544b1add4dd6.json`,
`access-index.aef0eb309860.json` and all 440 indexed service-road tiles. An offline
artifact audit verified every file hash and 9,344 unique service ways across 10,354
tile assignments. The index lists every tile, not just those used for one trip.
The public repository already supplies extraction, filtering, normalization,
packaging, tiling and both graph builders with their dependencies. These are
substantial existing evidence for the complete-data/method offer; neither a ZIP
nor a separately named LICENSE file is inherently required.

County and OSM graph inputs interact, so separate JSON layers alone do not establish
an independent-collection exemption. That does not establish a licensing violation
or a need for fresh permission. OSMF's CC BY import policy concerns importing data
into OSM; it cannot automatically impose a county waiver requirement on this app.
No confirmed licensing violation or separate licensing hold was found by this review.
This corrects the earlier assessment that missing data/source or a missing archive
was a demonstrated blocker. It does not certify every possible legal classification.

The minimal clarification adds a collapsed **Routing data downloads and license
details** section in existing Help/about. It links the actual dataset descriptor,
trail geometry, base roads, complete tile index, direct ODbL/CC BY terms and the
exact build's public source revision. County content terms remain intact; the whole
application is not relabeled ODbL. Existing map attribution stays visible. No removed
cards, new service, coverage removal, sharing change or runtime activation is needed.
A private 1.45 MB preparation archive remains optional evidence, not a required
public deliverable. Public sharing still awaits the capability choice below.

## Proposed connection design: retain coverage, separate evidence from guidance

Keep every admitted trail and road, plan/save/export coverage, closure exclusion and
proposed/unverified status. Turn off the private build assumption that treats
estimated connections as traversable for Start. Display each segment's actual
category: mapped trail, mapped street access (shared traffic), or missing/estimated
connection. Mapped geometry is not evidence of present legal access or safe passage.

The existing bridge already distinguishes these cases: `accessGapsOf` produces
estimated-gap descriptors, and `canNavigate` blocks those gaps unless the private
assumption is on. Ordinary mapped road access is not automatically treated as a
missing gap. This proposal preserves that distinction rather than blocking every
street leg or treating an OSM road as verified legal access.

Use the existing preview summary and accessible map markers, not restored private
cards: for example, **Route includes 2 connections the data cannot verify. You can
review and save this plan; guidance cannot cover those connections.** Keep gaps
as end markers rather than invented path lines, and preserve warnings in downloads.
After device acceptance, enable guidance for entirely supported routes only.
Do not increase snap tolerance, label an estimate verified, or unlock guidance with
an acknowledgement checkbox. Future guidance on supported portions while paused
at gaps requires a distinct design and regression proof.

**Product decision needed:** launch a planning beta first with all active guidance
disabled, or wait for physical acceptance and launch guidance for supported routes.
Either retains geographic data coverage; both change capability availability from
private v12 and require an explicit release choice. No capability change is made here.

## Physical acceptance: capability-specific, not a data-license requirement

Missing device evidence is a strong reservation for active outdoor guidance,
not a legal prohibition on public map viewing/planning. The existing #41 release
matrix requires both physical platforms for its full navigation launch. A planning
beta could narrow the acceptance claim only through the product decision above,
with Start and all resume/recovery/reroute paths actually disabled. Warnings alone
do not make the currently enabled private guidance a planning-only release.
Mobile planning still needs a short real-phone usability check.

Run on the **exact candidate** in iPhone Safari and Android Chrome. About 15–20
minutes per phone plus a short outdoor walk/ride; record device/OS/browser, commit,
artifact hash, PASS/FAIL/NOT RUN and observations. Do not record personal traces.

1. Fresh HTTPS visit: plan a point-to-point route and loop; save/reopen; large text
   and touch fit. Include one disconnected/estimated plan and one closure-blocked
   plan. These stay distinguishable from a supported route.
2. With active guidance allowed: request location outdoors; deny/retry, then allow.
   Observe first fix, timestamp and accuracy. Start only the fully supported route;
   stale/poor fixes must not produce misleading progress or a ready state.
3. Walk/ride a short supported section and an out-and-back junction. Compare turn,
   direction and progress with reality; do not follow a route through a known gap.
4. Lock/unlock and switch apps/tabs. Guidance pauses; return requires a fresh fix;
   no movement is credited while hidden. Check wake-lock denial leaves controls usable.
5. Reload/force-close, reopen and lose/restore network. No stale fix resumes guidance;
   failures/retry are honest and saves are not presented as offline navigation.
6. Stop returns to preview. Check foreground limitation, source attribution, public
   GitHub feedback warning, optional browser details unchecked and no automatic send.

A planning-only candidate runs steps 1 and 6 and additionally tries Start, restored
ride and reroute entry points to prove guidance is disabled. That cannot be recorded
as physical GPS/navigation acceptance. A failure in guidance blocks that capability;
no-device availability is recorded NOT RUN rather than replaced with emulation.
