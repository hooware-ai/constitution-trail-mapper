# Uptown Underpass trail closure mapping — September 27, 2026

Source: Town of Normal, [Parkinson Street Parking Lot To Close, Trail Closure & Detour](https://www.normalil.gov/m/newsflash/Home/Detail/3337) (September 14, 2026). From September 21, Constitution Trail is detoured around the Underpass construction zone. The trail first closes north of Vernon Avenue while a detour sidewalk is built. The detour then leaves the trail at the Phoenix Avenue intersection: west on Phoenix to Broadway, north on Broadway to the north sidewalk of Beaufort Street, and east on Beaufort to Uptown Circle, rejoining at the trailhead north of Uptown Circle. Bicyclists on Uptown sidewalks must dismount.

## Advisory corridor

`TrailRouteAdvisorySijko` uses an approximate corridor that follows county trail feature `54:1305` (Route 66 & Illinois Central):

- It starts at the trail's Phoenix Avenue crossing (40.507656, −88.984202). The TIGER `W Phoenix Ave` line begins about 13 m east of that point.
- It ends where the line meets the Uptown Circle trail loop (40.509023, −88.984155), beside TIGER `Uptown Cir` and `W Beaufort St`.
- It keeps the short digitized spur toward the Parkinson lot (to 40.509540, −88.982576), which lies inside the construction area.

It does not include:

- **The initial closure north of Vernon Avenue** while the detour sidewalk was built. The notice gives no end for that phase, and the long-term closure starts at Phoenix.
- **The loop around Uptown Circle, and the trail north of it.** The detour rejoins there.

## Matching

A route gets the advisory from September 21, 2026 onward if its *trail* segments run at least 40 m within 15 m of the corridor. Access (road) segments never match, so crossing streets such as Phoenix Avenue, Broadway and Beaufort don't trigger it, and neither does trail south of Phoenix. There is no end date: the June 2028 construction target is not a reopening.

On the shipped network (September 27 assets), the advisory appears on:

- trail routes through Uptown;
- the central five-mile start's 10-mile loop;
- 3/5/10-mile loops starting in Uptown.

It does not appear on the central 3- and 5-mile loops.

## Routing (#31)

From September 21, 2026, new trail routes and exercise loops exclude the closed section. `TrailRouteClosureSijko` removes feature `54:1305` between the Phoenix Avenue crossing vertex and the Uptown Circle loop entry vertex before the route graph is built. It keeps both vertices as open ends, and leaves the Collegiate branch, the circle loop and crossing streets untouched. The closure has no end date; lift it only after an official reopening notice has been reviewed.

The #29 advisory uses the same closure id, notice and start date.

- **No route avoids the closure:** if a trail route exists only through the closed section, the planner says "No route avoids the Uptown trail closure" and gives the signed detour. Trail Mapper does not route the detour itself.
- **Saved routes:** routes made earlier are not rerouted, and keep showing the advisory.

On September 27 assets, the two representative point routes that crossed Uptown (south→north, north→central) are each 862 m longer, and the other two are unchanged. `RouteGenerationRealDataAuditTest.uptownClosureStillMatchesTheShippedNetworkAndRoutesAvoidIt` fails if a data refresh moves the closure's bounding vertices.
