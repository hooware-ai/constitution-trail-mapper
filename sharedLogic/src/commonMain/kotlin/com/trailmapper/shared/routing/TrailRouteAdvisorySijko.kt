/**
 * Job: Match verified local work notices to road portions of new or saved routes.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.time.Clock

object TrailRouteAdvisorySijko {
    const val LatestClosureMapUrl =
        "https://experience.arcgis.com/experience/09937d80e7b8421e94fff9af03237b32/"

    private const val HamiltonAdvisoryId = "hamilton-rhodes-2026-08-17"
    private const val HamiltonNoticeUrl =
        "https://www.bloomingtonil.gov/Home/Components/News/News/10909/1394"
    private const val HamiltonClosureStartEpochMillis = 1_786_968_000_000L
    // The official city closure map (object 841, last edited September 25, 2026) now estimates October 31, 2026 at
    // 6 p.m. CDT; the older city notice said September 30. Either is an estimate, never a confirmed reopening.
    private const val HamiltonEstimatedEndEpochMillis = 1_793_487_600_000L

    // How close a route leg must be to the Camelback crossing point to count as traversing it. The point comes from the
    // intersection of the city's road line with the county trail leg, so a few meters absorb the map's own precision.
    private const val CrossingToleranceMeters = 3.0

    // A leg is "on" a closed section when both its ends are within this distance of the section's line: the section
    // lies on the unchanged source leg, so travel along it is exact to rounding, and a perpendicular crossing is not.
    private const val OnSectionLineToleranceMeters = 0.5

    // Overlap with the section's interval counts above this: numerical noise only, never a minimum riding distance.
    private const val SectionOverlapEpsilonMeters = 0.01

    // Direction alignment (cosine) needed to call a leg longitudinal when a route has no per-edge provenance.
    private const val LongitudinalCosine = 0.9
    private const val MetersPerDegree = 111_194.93

    // A requested start or destination counts as inside a closed section within this distance of its line.
    private const val InsideSectionToleranceMeters = 2.0
    private const val CorridorMatchToleranceMeters = 25.0

    // The advisory warns about the same closure that new route searches exclude.
    private val UptownAdvisoryId = TrailRouteClosureSijko.uptownUnderpass.id
    private val UptownNoticeUrl = TrailRouteClosureSijko.uptownUnderpass.noticeUrl
    private val UptownDetourStartEpochMillis = TrailRouteClosureSijko.uptownUnderpass.activeFromEpochMillis
    private const val UptownTrailMatchToleranceMeters = 15.0
    private const val UptownMinimumOverlapMeters = 40.0
    private const val UptownSampleSpacingMeters = 5.0

    // County trail feature 54:1305 from its Phoenix Avenue crossing to the Uptown Circle loop,
    // checked against the Town of Normal's September 14, 2026 detour notice. The initial closure
    // north of Vernon Avenue, while the detour sidewalk was built, is not mapped here.
    private val uptownCorridor = TrailRouteAdvisoryCorridor(
        advisoryId = UptownAdvisoryId,
        label = "Uptown trail closure, Phoenix Avenue to Uptown Circle (approximate; not exact closure limits)",
        points = listOf(
            MapPoint(latitude = 40.507656, longitude = -88.984202),
            MapPoint(latitude = 40.507674, longitude = -88.984137),
            MapPoint(latitude = 40.507662, longitude = -88.984056),
            MapPoint(latitude = 40.507656, longitude = -88.983955),
            MapPoint(latitude = 40.507679, longitude = -88.983837),
            MapPoint(latitude = 40.507719, longitude = -88.983807),
            MapPoint(latitude = 40.508049, longitude = -88.983831),
            MapPoint(latitude = 40.508151, longitude = -88.983809),
            MapPoint(latitude = 40.508292, longitude = -88.983692),
            MapPoint(latitude = 40.508501, longitude = -88.983851),
            MapPoint(latitude = 40.508589, longitude = -88.983823),
            MapPoint(latitude = 40.509170, longitude = -88.982741),
            MapPoint(latitude = 40.509338, longitude = -88.982564),
            MapPoint(latitude = 40.509540, longitude = -88.982576),
            MapPoint(latitude = 40.508798, longitude = -88.983965),
            MapPoint(latitude = 40.509023, longitude = -88.984155),
        ),
        sourceUrl = UptownNoticeUrl,
    )

    // Object 841 of the official construction map, checked September 7, 2026. This
    // line depicts the whole work corridor, not the notice's precise 512–519 barriers.
    private val hamiltonCorridor = TrailRouteAdvisoryCorridor(
        advisoryId = HamiltonAdvisoryId,
        label = "Hamilton/Rhodes work corridor (approximate; not exact closure limits)",
        points = listOf(
            MapPoint(latitude = 40.4512277313916, longitude = -88.9813226624867),
            MapPoint(latitude = 40.4513485856116, longitude = -88.9667059346487),
        ),
        sourceUrl = LatestClosureMapUrl,
    )

    // The Town's closure map line for the Willow Street trail closure, projected onto the county trail: an approximate
    // display corridor, not surveyed barricade locations (the routing exclusion is in TrailRouteClosureSijko).
    private val willowCorridor = TrailRouteAdvisoryCorridor(
        advisoryId = TrailRouteClosureSijko.willowTrailCrossing.id,
        label = "Willow Street trail closure, Locust Street to Cypress Avenue (approximate; not exact closure limits)",
        points = TrailRouteClosureSijko.willowTrailCrossing.closedPath,
        sourceUrl = TrailRouteClosureSijko.willowTrailCrossing.noticeUrl,
    )

    // The bundled TIGER source duplicates this same road under both names. IDs
    // support older saved routes whose drawable segments did not retain names.
    private val hamiltonAccessFeatureIds = setOf("8:2368212", "8:3333226")
    private val hamiltonRoadNames = Regex(
        "^(?:(?:e|east|w|west) )?hamilton (?:rd|road)$|^rhodes (?:ln|lane)$",
    )

    fun forRoute(
        route: TrailRoute,
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
    ): List<TrailRouteAdvisory> {
        return listOfNotNull(
            hamiltonAdvisory(route, nowEpochMillis),
            uptownAdvisory(route, nowEpochMillis),
            willowAdvisory(route, nowEpochMillis),
            camelbackAdvisory(route, nowEpochMillis),
        )
    }

    /**
     * The Willow Street trail closure. Before it begins this is a notice that it is SCHEDULED and does not claim a
     * closure; from its start it is the blocking advisory the gate uses, and it stays so after the estimated end
     * until an official status update is reviewed.
     */
    private fun willowAdvisory(route: TrailRoute, nowEpochMillis: Long): TrailRouteAdvisory? {
        val closure = TrailRouteClosureSijko.willowTrailCrossing
        if (!ridesClosedSection(route, closure)) {
            return null
        }
        val estimate = closure.estimatedEndEpochMillis
        val active = nowEpochMillis >= closure.activeFromEpochMillis
        val end = if (estimate != null && nowEpochMillis > estimate) {
            "The Town's estimated completion, 5 p.m. CDT on Monday, October 19, has passed; reopening has not been confirmed."
        } else {
            "The Town estimates completion by 5 p.m. CDT on Monday, October 19, weather permitting; an estimate does not confirm reopening."
        }
        val detour = "The Town's detour is Fell Avenue, via Locust Street and Cypress Street."
        return if (active) {
            TrailRouteAdvisory(
                id = closure.id,
                title = "Willow Street trail closure advisory",
                message = "This route rides Constitution Trail's Illinois Central Branch between Locust Street and " +
                    "Cypress Avenue, closed since 6 a.m. CDT on Monday, October 5, 2026 to rebuild the Willow Street " +
                    "trail crossing. $detour $end The closed section is approximate (about 202 m, from the Town's " +
                    "closure map). This route has not been detoured.",
                sourceUrl = closure.noticeUrl,
                locationDescription = "Constitution Trail, Illinois Central Branch, Locust Street to Cypress Avenue, at " +
                    "Willow Street, Normal. The map overlay is approximate. Checked ${closure.checkedOn}.",
            )
        } else {
            TrailRouteAdvisory(
                id = closure.id,
                title = "Scheduled Willow Street trail closure",
                message = "Scheduled, not closed yet: the Town of Normal will close Constitution Trail's Illinois Central " +
                    "Branch between Locust Street and Cypress Avenue, to rebuild the Willow Street trail crossing, " +
                    "beginning 6 a.m. CDT on Monday, October 5, 2026. This route rides that section and has not been " +
                    "changed. $detour $end",
                sourceUrl = closure.noticeUrl,
                locationDescription = "Constitution Trail, Illinois Central Branch, Locust Street to Cypress Avenue, at " +
                    "Willow Street, Normal. Checked ${closure.checkedOn}.",
            )
        }
    }

    /**
     * The Camelback Bridge crossing. A route that travels through the crossing on the county trail is a route over a
     * trail the Town says is closed: scheduled before 8 a.m. CDT on October 5, a refused route from then on, including
     * after the estimated end (an estimate is not a reopening). Without published limits nothing is cut or drawn, so the
     * router does not plan around it: the route can be previewed, and cannot be started.
     */
    private fun camelbackAdvisory(route: TrailRoute, nowEpochMillis: Long): TrailRouteAdvisory? {
        val closure = TrailRouteClosureSijko.camelbackCrossing
        if (!traversesCrossing(route, closure)) {
            return null
        }
        val estimate = closure.estimatedEndEpochMillis
        val end = if (estimate != null && nowEpochMillis > estimate) {
            "The Town's estimated completion, 5 p.m. CDT on Tuesday, October 6, has passed; reopening has not been confirmed."
        } else {
            "The Town estimates completion by 5 p.m. CDT on Tuesday, October 6, weather permitting; an estimate does not confirm reopening."
        }
        val limits = "The notice gives no trail detour and no closure limits along the trail, so Trail Mapper cannot " +
            "plan around it and does not start this route; follow the Town's posted signs."
        // Before the closure begins nothing is refused yet: say what WILL happen, not that it is happening.
        val scheduledLimits = "The notice gives no trail detour and no closure limits along the trail, so Trail Mapper " +
            "cannot plan around it. This route can still be started until then; from 8 a.m. CDT on October 5 Trail " +
            "Mapper will not start a route that crosses there. Follow the Town's posted signs."
        return if (nowEpochMillis >= closure.activeFromEpochMillis) {
            TrailRouteAdvisory(
                id = closure.id,
                title = "Virginia Avenue (Camelback Bridge) trail closure advisory",
                message = "This route crosses Virginia Avenue at the Camelback Bridge, where the Town of Normal closed " +
                    "Constitution Trail from 8 a.m. CDT on Monday, October 5, 2026, with Virginia Avenue closed between " +
                    "South Linden and Hillcrest Streets for bridge inspection and maintenance. $limits $end",
                sourceUrl = closure.noticeUrl,
                locationDescription = "Constitution Trail at Virginia Avenue (Camelback Bridge), Normal. Notice posted " +
                    "September 30, 2026; checked ${closure.checkedOn}.",
            )
        } else {
            TrailRouteAdvisory(
                id = closure.id,
                title = "Scheduled trail closure at Virginia Avenue (Camelback Bridge)",
                message = "Scheduled, not closed yet: the Town of Normal will close Constitution Trail at Virginia " +
                    "Avenue (Camelback Bridge) from 8 a.m. CDT on Monday, October 5, 2026, with Virginia Avenue closed " +
                    "between South Linden and Hillcrest Streets for bridge inspection and maintenance. This route " +
                    "crosses there. $scheduledLimits $end",
                sourceUrl = closure.noticeUrl,
                locationDescription = "Constitution Trail at Virginia Avenue (Camelback Bridge), Normal. Notice posted " +
                    "September 30, 2026; checked ${closure.checkedOn}.",
            )
        }
    }

    /**
     * True when any point of [route], of ANY segment type (an unrouted, estimated hop included), lies strictly inside the
     * mapped section of a closure that is in force at [nowEpochMillis]. A replacement route whose start or destination is
     * inside a closed section is not a way around it, even when its only geometry is an estimated hop to the nearest bound
     * and back: that hop is not travel along the trail, so the travel gate alone does not see it.
     */
    fun entersClosedSection(route: TrailRoute, nowEpochMillis: Long): Boolean {
        return TrailRouteClosureSijko.activeClosures(nowEpochMillis).any { entersClosedSection(route, it) }
    }

    /** The same, for one closure (false for a closure with no mapped section). */
    fun entersClosedSection(route: TrailRoute, closure: TrailRouteClosure): Boolean {
        if (!closure.boundsProjected || closure.isCrossing) {
            return false
        }
        val points = route.segments.flatMap { it.points }
        return closure.closedPath.zipWithNext().any { (from, to) ->
            points.any { point -> insideSection(point, from, to) }
        }
    }

    private fun insideSection(point: MapPoint, from: MapPoint, to: MapPoint): Boolean {
        val cosLatitude = kotlin.math.cos(from.latitude * kotlin.math.PI / 180.0)
        fun x(p: MapPoint) = (p.longitude - from.longitude) * cosLatitude * MetersPerDegree
        fun y(p: MapPoint) = (p.latitude - from.latitude) * MetersPerDegree
        val length = kotlin.math.hypot(x(to), y(to))
        if (length <= 0.0) {
            return false
        }
        val directionX = x(to) / length
        val directionY = y(to) / length
        val along = x(point) * directionX + y(point) * directionY
        val across = kotlin.math.abs(x(point) * directionY - y(point) * directionX)
        return across <= InsideSectionToleranceMeters &&
            along > SectionOverlapEpsilonMeters && along < length - SectionOverlapEpsilonMeters
    }

    /** Legs of trail travel that could be on [closure]'s feature, with whether their source is known to be it. */
    private fun candidateLegs(route: TrailRoute, closure: TrailRouteClosure): List<Pair<Pair<MapPoint, MapPoint>, Boolean>> {
        if (route.edges.isEmpty()) {
            // A route without per-edge provenance: its merged trail segments, judged by geometry alone.
            return route.segments
                .filter { it.type == TrailRouteSegmentType.Trail && TrailNetworkRole.SharedRoadways !in it.routeRoles }
                .flatMap { segment -> segment.points.zipWithNext().map { it to false } }
        }
        return route.edges
            // The closure's own feature, or an edge with no recorded source (a snap connector made along it).
            .filter { it.sourceFeatureId == closure.featureId || it.sourceFeatureId == null }
            .flatMap { edge ->
                val known = edge.sourceFeatureId == closure.featureId
                edge.routeSegments
                    .filter { it.type == TrailRouteSegmentType.Trail }
                    .flatMap { segment -> segment.points.zipWithNext().map { it to known } }
            }
    }

    /** Does the route travel through the closure's crossing point on its feature? Touching the point counts. */
    private fun traversesCrossing(route: TrailRoute, closure: TrailRouteClosure): Boolean {
        return candidateLegs(route, closure).any { (leg, _) ->
            TrailDistanceSijko.projectToSegment(closure.closedFrom, leg.first, leg.second).distanceMeters <=
                CrossingToleranceMeters
        }
    }

    /**
     * Positive travel ALONG the closed section: some leg of the route lies on the section's line and covers part of its
     * interval. Any amount counts (a short route wholly inside it, or a few meters past either bound), with numerical
     * tolerance only. A perpendicular crossing, a junction hop or an approach that ends at a bound has no leg on the line
     * that overlaps the interval, so it is not travel along the section.
     */
    private fun ridesClosedSection(route: TrailRoute, closure: TrailRouteClosure): Boolean {
        val legsOfSection = closure.closedPath.zipWithNext()
        if (legsOfSection.isEmpty()) {
            return false
        }
        return candidateLegs(route, closure).any { (leg, known) ->
            legsOfSection.any { (from, to) -> overlapsSection(leg.first, leg.second, from, to, requireAlignment = !known) }
        }
    }

    private fun overlapsSection(
        start: MapPoint,
        end: MapPoint,
        from: MapPoint,
        to: MapPoint,
        requireAlignment: Boolean,
    ): Boolean {
        val cosLatitude = kotlin.math.cos(from.latitude * kotlin.math.PI / 180.0)
        fun x(point: MapPoint) = (point.longitude - from.longitude) * cosLatitude * MetersPerDegree
        fun y(point: MapPoint) = (point.latitude - from.latitude) * MetersPerDegree
        val sectionX = x(to)
        val sectionY = y(to)
        val length = kotlin.math.hypot(sectionX, sectionY)
        if (length <= 0.0) {
            return false
        }
        val directionX = sectionX / length
        val directionY = sectionY / length
        fun along(point: MapPoint) = x(point) * directionX + y(point) * directionY
        fun across(point: MapPoint) = kotlin.math.abs(x(point) * directionY - y(point) * directionX)
        if (across(start) > OnSectionLineToleranceMeters || across(end) > OnSectionLineToleranceMeters) {
            return false
        }
        val a = along(start)
        val b = along(end)
        if (requireAlignment) {
            val legX = x(end) - x(start)
            val legY = y(end) - y(start)
            val legLength = kotlin.math.hypot(legX, legY)
            if (legLength <= 0.0 || kotlin.math.abs((legX * directionX + legY * directionY) / legLength) < LongitudinalCosine) {
                return false
            }
        }
        val overlap = kotlin.math.min(kotlin.math.max(a, b), length) - kotlin.math.max(kotlin.math.min(a, b), 0.0)
        return overlap > SectionOverlapEpsilonMeters
    }

    private fun hamiltonAdvisory(route: TrailRoute, nowEpochMillis: Long): TrailRouteAdvisory? {
        if (nowEpochMillis < HamiltonClosureStartEpochMillis || !usesHamiltonWorkCorridor(route)) {
            return null
        }
        val schedule = if (nowEpochMillis > HamiltonEstimatedEndEpochMillis) {
            "The estimated completion, 6 p.m. CDT on October 31, 2026, has passed; reopening has not been confirmed."
        } else {
            "Completion is estimated for 6 p.m. CDT on October 31, 2026 (the older notice said September 30); " +
                "an estimate does not confirm reopening."
        }
        return TrailRouteAdvisory(
            id = HamiltonAdvisoryId,
            title = "Hamilton/Rhodes closure advisory",
            message = "This route uses the Hamilton/Rhodes work corridor. The city's closure map (object 841, last " +
                "edited September 25, 2026) reports Hamilton Road / Rhodes Lane closed to through traffic, and the " +
                "city notice, last checked September 7, 2026, reports an all-traffic closure between " +
                "512 and 519 E. Hamilton Road. $schedule Exact barrier locations are not mapped. " +
                "Use another road connection and check the city notice; this route has not been detoured.",
            sourceUrl = HamiltonNoticeUrl,
            locationDescription = "Hamilton Road / Rhodes Lane, between 512 and 519 E. Hamilton Road. " +
                "The map overlay shows the broader work corridor; a parallel trail is not marked closed.",
        )
    }

    private fun uptownAdvisory(route: TrailRoute, nowEpochMillis: Long): TrailRouteAdvisory? {
        if (nowEpochMillis < UptownDetourStartEpochMillis || !usesUptownClosedTrail(route)) {
            return null
        }
        // No end date: the June 2028 construction target is not a reopening.
        return TrailRouteAdvisory(
            id = UptownAdvisoryId,
            title = "Uptown trail detour advisory",
            message = "This route follows Constitution Trail through the Uptown Underpass construction zone. " +
                "The Town of Normal's September 14, 2026 notice detours the trail from September 21: west on " +
                "Phoenix Avenue to Broadway Avenue, north on Broadway to the north sidewalk of Beaufort Street, " +
                "then east on Beaufort to Uptown Circle and the trailhead north of it. On Uptown sidewalks, " +
                "dismount and walk your bike; in the street, follow traffic up Beaufort and around Uptown Circle. " +
                "This route has not been detoured. The construction target does not confirm a reopening.",
            sourceUrl = UptownNoticeUrl,
            locationDescription = "Constitution Trail from Phoenix Avenue to Uptown Circle, Uptown Normal. " +
                "The map overlay follows the county trail line and is approximate.",
        )
    }

    fun approximateCorridors(
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
    ): List<TrailRouteAdvisoryCorridor> {
        // An estimated end is deliberately not an automatic reopening. Remove or
        // revise the advisory only after an authoritative status update is reviewed.
        return listOfNotNull(
            hamiltonCorridor.takeIf { nowEpochMillis >= HamiltonClosureStartEpochMillis },
            uptownCorridor.takeIf { nowEpochMillis >= UptownDetourStartEpochMillis },
            willowCorridor.takeIf { nowEpochMillis >= TrailRouteClosureSijko.willowTrailCrossing.activeFromEpochMillis },
        )
    }

    /** Only trail travel along the closed line counts; crossing streets and nearby trails do not. */
    private fun usesUptownClosedTrail(route: TrailRoute): Boolean {
        val corridorLegs = uptownCorridor.points.zipWithNext()
        var overlapMeters = 0.0
        route.segments
            .filter { segment -> segment.type == TrailRouteSegmentType.Trail }
            .forEach { segment ->
                segment.points.zipWithNext().forEach { (start, end) ->
                    val legMeters = TrailDistanceSijko.metersBetween(start, end)
                    val samples = maxOf(1, (legMeters / UptownSampleSpacingMeters).toInt())
                    repeat(samples) { sample ->
                        val ratio = (sample + 0.5) / samples
                        val point = MapPoint(
                            latitude = start.latitude + (end.latitude - start.latitude) * ratio,
                            longitude = start.longitude + (end.longitude - start.longitude) * ratio,
                        )
                        val nearCorridor = corridorLegs.any { (corridorStart, corridorEnd) ->
                            TrailDistanceSijko.projectToSegment(point, corridorStart, corridorEnd).distanceMeters <=
                                UptownTrailMatchToleranceMeters
                        }
                        if (nearCorridor) {
                            overlapMeters += legMeters / samples
                        }
                    }
                }
            }
        return overlapMeters >= UptownMinimumOverlapMeters
    }

    private fun usesHamiltonWorkCorridor(route: TrailRoute): Boolean {
        if (route.segments.any { segment ->
                segment.type == TrailRouteSegmentType.Access && segment.isRouted &&
                    matchesRoadName(segment.name) && touchesCorridor(segment.points)
            }
        ) {
            return true
        }
        return route.edges.any { edge ->
            edge.ordinaryAccessDistanceMeters > 0.0 &&
                edge.accessRoadClass !in setOf("S1710", "S1820") &&
                edge.routeSegments.any { segment ->
                    segment.type == TrailRouteSegmentType.Access && segment.isRouted &&
                        (matchesRoadName(segment.name) || edge.sourceFeatureId in hamiltonAccessFeatureIds) &&
                        touchesCorridor(segment.points)
                }
        }
    }

    private fun matchesRoadName(name: String?): Boolean {
        val normalized = name?.lowercase()?.replace(".", "")?.trim()?.replace(Regex("\\s+"), " ")
            ?: return false
        return hamiltonRoadNames.matches(normalized)
    }

    private fun touchesCorridor(points: List<MapPoint>): Boolean {
        val corridorStart = hamiltonCorridor.points.first()
        val corridorEnd = hamiltonCorridor.points.last()
        return points.zipWithNext().any { (first, second) ->
            TrailDistanceSijko.projectToSegment(first, corridorStart, corridorEnd).distanceMeters <=
                CorridorMatchToleranceMeters ||
                TrailDistanceSijko.projectToSegment(second, corridorStart, corridorEnd).distanceMeters <=
                CorridorMatchToleranceMeters ||
                TrailDistanceSijko.projectToSegment(corridorStart, first, second).distanceMeters <=
                CorridorMatchToleranceMeters ||
                TrailDistanceSijko.projectToSegment(corridorEnd, first, second).distanceMeters <=
                CorridorMatchToleranceMeters
        }
    }
}
