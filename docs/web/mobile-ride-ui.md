# Mobile ride UI candidate

## MagicPath design reference

Compared against `Trail-Mapper-Mobile-Source.txt` (MagicPath final revision
`457503697161818112`). This implementation carries over the full-screen ride
map, large turn and distance, rider position below center, heading-up follow,
drag-to-pause/Recenter, compact exceptional-state line, collapsed secondary
details, and phone-safe controls. Its map, route, heading, GPS, closures, and
remaining distance come from the existing Trail Mapper app rather than the
prototype's illustrated map and fixed demo values. The prototype's arrival
time, voice toggle, difficulty, climb, and sample trails are omitted because
this candidate has no verified live value or production service for them. The
existing optional street-map setting remains off by default pending the map
provider decision.

This isolated candidate gives navigation its own full-screen map and two glanceable
surfaces: the next instruction at the top and distance, Directions, Ride details,
and Stop at the bottom. Planning and riding use separate views. The route, closure,
location, and Start decisions still come from the existing shared routing and
navigation code.

The ride map uses a locally bundled MapLibre worker. A reliable browser heading
and speed rotate and pitch the map; movement can supply heading when the browser
does not. Until either is reliable, the camera remains north-up. The rider stays
below the map center to show more of the route ahead. Dragging pauses following;
Recenter resumes it. Location loss clears the live position and guidance. A flat
Leaflet map remains available if WebGL cannot start. The optional OSM street tiles
remain off until the rider enables them.

Mapped route, access-road legs, estimated connections, and known closures have
distinct map strokes. Off-route checking, lost location, and offline status stay
visible while riding. The private review mode keeps its immediate unverified
connection warning. Other explanatory text is in Ride details. The mobile plan
screen keeps a visible Start action; a blocked Start still shows its reason.

Local evidence: the synthetic review build passed the core verification, build and
distribution audit, built-artifact ride-camera smoke test under production CSP,
and focused Chromium phone tests for 320-430px widths, 175% text, heading rotation,
pan/recenter, GPS loss/recovery, WebGL fallback and Stop. These tests do not establish physical
phone, sunlight, battery, outdoor GPS, or accessibility acceptance. No candidate
was uploaded or deployed.

The complete mobile Chromium rider and simplified-layout suite passed **109/109**
on this isolated candidate. A separate six-case ride-camera suite passed,
including small-phone layout and the flat-map fallback. This does not substitute
for iPhone Safari, Android Chrome, screen-reader or outdoor acceptance.

## Real county candidate check (October 4)

The isolated branch loaded the same unapproved, Proposed-off package used by the
private v4 review snapshot: network SHA-256
`903e43cf077acf79988920eb114b02e0f90bab022180aca88f5205c7a1ed882d`
(254 Existing trails, four reviewed OSM paths, and 12,737 endpoint access roads).
The county package verifier and private and strict local builds passed. On a
390px Chromium viewport, Tipton Park North to Culver's Hershey Road reached the
new ride camera in the private assumption build, with the estimated connection
and PRIVATE TEST MODE visible. With the assumption off, the same trip kept Start
disabled. Neither build fetched OSM street tiles by default. The real county
planner took about 7.3 seconds to become ready in one local browser run; phone
load time remains unmeasured.

Focused real-asset closure tests passed 29/29, including Willow and Camelback
interval, Start, and recalculation controls. This is bounded local evidence for
the candidate, not public-data approval or outdoor acceptance. The inherited
release dataset description still says OSM supplements and access roads are
omitted although this private package includes them; its rights and provenance
record needs owner reconciliation before any publication.
