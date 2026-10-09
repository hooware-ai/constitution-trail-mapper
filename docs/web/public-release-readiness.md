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

| Material                    | Existing evidence/notices                                                                                                                                                                                 | Remaining work                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| County trails               | `dataset.json` carries McGIS credit, CC BY 4.0 link, licensed source/evidence URL, changes and disclaimer. Help and exports retain these. The official Trails item still declares CC BY 4.0 on October 9. | Preserve these notices in a complete download. Decide compatibility of the combined database, not whether the included county subset has a license. |
| Four OSM paths              | Separate `verified-osm` layer, OSM attribution and ODbL license name/copyright link in dataset, Help and exports.                                                                                         | Include in the complete offer and state the database license treatment.                                                                             |
| OSM service roads           | OSM credit/copyright link in Help and exports. Every normalized way is shipped in hash-indexed endpoint-local tiles.                                                                                      | An explicit versioned offer must include **all** tiles, not only those fetched for a selected trip.                                                 |
| TIGER/Line roads            | Census identified in Help/exports; base roads shipped separately.                                                                                                                                         | Retain origin and public-domain notice in the offer.                                                                                                |
| Optional OSM raster basemap | Linked attribution, disabled by default; privacy disclosure and no bulk/offline harvesting.                                                                                                               | Accept best-effort availability or choose a different provider later. This does not decide geometry licensing.                                      |

Primary terms: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.en)
requires source credit, license notice, modification disclosure and retained supplied
notices. [Census](https://www.census.gov/newsroom/archives/2014-pr/cb14-208.html)
identifies TIGER as public-domain geospatial data.
[OSMF attribution guidance](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)
recognizes OSM credit for routing engines and applications; the existing copyright
link is useful attribution, not evidence that share-alike/source-offer work is done.

## The concrete ODbL question and smallest complete offer

[ODbL sections 4.2–4.6](https://opendatacommons.org/licenses/odbl/1-0/)
require notices; public use of a derivative database triggers share-alike and a free
machine-readable database or complete alterations/method offer. Application code
is outside the database license. A repository of manifests containing only hashes
and a route GeoJSON containing one route are not the entire modified database.

Technical finding: county and OSM trails share the same trail graph builder, which
snaps points within 15 metres; TIGER and OSM roads share the access graph builder,
which snaps within eight metres. These interact to route a trip. Separate JSON
layers do not establish an independent-collection exemption. The
[OSMF horizontal-layer guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Horizontal_Map_Layers_-_Guideline)
warns that mixing sources for the same feature type can engage share-alike.
The JSON geometry is extractable data, unlike a raster display alone; see the
[Produced Work guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline).
Treating the combined routing dataset as derivative is the conservative proposal,
not an accepted legal conclusion about this particular graph.

The smallest implementation preserving coverage is:

1. Publish one free, versioned data download with the existing `data/dataset.json`,
   `trails.903e43cf077a.json`, `access-base.544b1add4dd6.json`,
   `access-index.aef0eb309860.json` and all 440 indexed service-road tiles.
   These are 444 data files already in the verified app. Audit every size/hash;
   deduplicate tile identities to prove 9,344 ways and preserve their original
   `ord` values. No new extract or geometry change is needed.
2. Include a source-notice README and file manifest. Preserve county CC BY notices,
   OSM attribution and direct ODbL URI, Census origin, source versions and filtering/
   normalization/tile changes. Identify the accepted database license separately
   from underlying source-content licenses. Do not rewrite county rights as solely
   ODbL or relabel the whole application.
3. Supply the exact graph-construction method and source revision, including
   `TrailGraphBuilderSijko`, `AccessGraphBuilderSijko`, parsing/filtering/tiling and
   referenced dependencies. Verify complete reconstruction; offering these methods
   plus all additional contents is a candidate section 4.6(b) approach, not a
   certification that a raw-input archive alone covers every graph modification.
4. Add a discoverable **Download routing data and license notices** link under the
   existing Data sources and licenses section. Keep it available to recipients;
   never require payment, an email request or a selected ride. No removed cards
   are restored. The same artifact offer must remain associated with its version.

A private preparation archive verifies all 444 bytesets and the 440 tiles:
9,344 unique service ways, 10,354 tile assignments, approximately 1.45 MB compressed.
It is **not published or licensed as a combined database**. The archive does not
contain personal routes, GPS traces or credentials. Exact construction-method
packaging and an accepted database notice remain outstanding.

**Legal acceptance needed:** whether this combined database can be offered under
ODbL while preserving all county CC BY obligations, including downstream terms,
or whether an applicable waiver/permission or alternative architecture is needed.
[OSMF's CC BY 4.0 analysis](https://blog.openstreetmap.org/2017/03/17/use-of-cc-by-data/)
flags compatibility concerns for imports into OSM. This app is not importing into
OSM: that policy neither proves our combination unlawful nor supplies a waiver.
Owner willingness to publish cannot waive another licensor's conditions. No
rightsholder contact, paid advice, waiver acceptance or coverage removal is authorized.

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
