# Mobile ride UI candidate

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
distinct map strokes. The private review mode keeps its immediate unverified
connection warning. Other explanatory text is in Ride details. The mobile plan
screen keeps a visible Start action; a blocked Start still shows its reason.

Local evidence: the synthetic review build passed the core verification, build and
distribution audit, built-artifact ride-camera smoke test under production CSP,
and focused Chromium phone tests for 320–430px widths, 175% text, heading rotation,
pan/recenter, GPS loss/recovery, WebGL fallback and Stop. These tests do not establish physical
phone, sunlight, battery, outdoor GPS, or accessibility acceptance. No candidate
was uploaded or deployed.
