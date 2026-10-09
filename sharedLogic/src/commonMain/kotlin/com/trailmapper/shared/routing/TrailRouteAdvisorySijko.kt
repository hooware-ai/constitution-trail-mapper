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

    // A leg is "on" a line when both its ends are within this distance of it: planned geometry lies ON the raw source
    // line, or ON the derived leg that replaces it, so travel along either is exact to rounding, and a perpendicular
    // crossing is not.
    private const val OnSectionLineToleranceMeters = 0.5

    // Polylines whose ends meet within this distance are one continuous geometry.
    private const val JoinMeters = 0.01

    // An estimated hop has no source at all, so it is judged with the graph's own reach: the distance within which the
    // graph moves a vertex onto a neighboring node.
    private const val GraphReachMeters = TrailGraphBuilderSijko.DEFAULT_SNAP_TOLERANCE_METERS

    // Overlap with the section's interval counts above this: numerical noise only, never a minimum riding distance.
    private const val SectionOverlapEpsilonMeters = 0.01

    // Direction alignment (cosine) needed to call a leg longitudinal.
    private const val LongitudinalCosine = 0.9

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

    /**
     * The notices that apply to [route] at [nowEpochMillis]. [derived] is where the loaded graph's derived geometry stands
     * for a closure's source leg ([TrailRouteClosureDerivationSijko.legsFor]); a front end that has the graph passes it so
     * a route snapped onto displaced node anchors is judged against the interval transferred onto them exactly (an empty
     * list says the graph was checked and has none). Null, the default, says the correspondence is UNAVAILABLE, and the
     * gate then FAILS CLOSED rather than guess where the graph moved anything: a leg of the closure's own feature (or an
     * unattributed trail leg) that comes within the graph's snap reach of the closed section, or of the crossing, counts as
     * riding it. The graph moves any vertex by at most that reach, so a leg that rides the carried interval always comes
     * within it of the raw one (the carried interval is a convex combination of anchors each within the reach of its source
     * vertex); nothing about alignment or whether the leg is on the unchanged line is assumed, because an anchor can move
     * along the line as well as across it. The price is deliberate: with no graph, travel on the closure's own feature
     * within that reach of a closed section or crossing is refused, including an approach that ends at a bound.
     */
    fun forRoute(
        route: TrailRoute,
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
        derived: List<TrailRouteDerivedClosureLeg>? = null,
    ): List<TrailRouteAdvisory> {
        return listOfNotNull(
            hamiltonAdvisory(route, nowEpochMillis),
            uptownAdvisory(route, nowEpochMillis),
            willowAdvisory(route, nowEpochMillis, derived),
            camelbackAdvisory(route, nowEpochMillis, derived),
        )
    }

    /**
     * The Willow Street trail closure. Before it begins this is a notice that it is SCHEDULED and does not claim a
     * closure; from its start it is the blocking advisory the gate uses, and it stays so after the estimated end
     * until an official status update is reviewed.
     */
    private fun willowAdvisory(route: TrailRoute, nowEpochMillis: Long, derived: List<TrailRouteDerivedClosureLeg>?): TrailRouteAdvisory? {
        val closure = TrailRouteClosureSijko.willowTrailCrossing
        if (!ridesClosedSection(route, closure, derived)) {
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
    private fun camelbackAdvisory(route: TrailRoute, nowEpochMillis: Long, derived: List<TrailRouteDerivedClosureLeg>?): TrailRouteAdvisory? {
        val closure = TrailRouteClosureSijko.camelbackCrossing
        if (!traversesCrossing(route, closure, derived)) {
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
            "cannot plan around it. Until then this closure does not stop Trail Mapper from starting a route (other " +
            "closures and checks may); from 8 a.m. CDT on October 5 Trail Mapper will not start a route that crosses " +
            "there. Follow the Town's posted signs."
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
     * True when an ESTIMATED hop of [route] (an unrouted segment: geometry nothing in the network supports) starts, ends
     * or travels inside the mapped section of a closure that is in force at [nowEpochMillis]. A replacement route whose
     * start or destination is inside a closed section is not a way around it when its only geometry there is an estimated
     * hop to the nearest bound and back: that hop is not travel along a trail, so the travel gate alone does not see it.
     * A routed segment is never judged by its vertices: a mapped road that crosses the trail inside the section is an
     * ordinary road whatever vertices it keeps, and a leg of trail travel is judged by the travel gate.
     */
    fun entersClosedSection(route: TrailRoute, nowEpochMillis: Long): Boolean {
        return TrailRouteClosureSijko.activeClosures(nowEpochMillis).any { entersClosedSection(route, it) }
    }

    /** The same, for one closure (false for a closure with no mapped section). */
    fun entersClosedSection(route: TrailRoute, closure: TrailRouteClosure): Boolean {
        if (!closure.boundsProjected || closure.isCrossing) {
            return false
        }
        val frame = frameOf(closure) ?: return false
        val (low, high) = intervalOf(frame, closure)
        return route.segments.filter { !it.isRouted }.any { segment ->
            // An estimated hop has no source: it is judged with the graph's own reach.
            segment.points.any { insideInterval(frame, it, low, high, GraphReachMeters) } ||
                travelsAlongPath(frame, segment.points, low, high, GraphReachMeters)
        }
    }

    /**
     * One polyline of trail travel, with whether its source is known to be the closure's feature and whether it is
     * attributed to that feature or to no feature at all (a snap connector made along a run), which is what the
     * unavailable-map fallback judges.
     */
    private class Candidate(val points: List<MapPoint>, val known: Boolean, val attributed: Boolean = known)

    /**
     * Polylines of trail travel that could be on [closure]'s feature. They stay whole: a decision about travel is made on
     * the continuous polyline, so it cannot depend on how many collinear vertices the geometry happens to keep.
     */
    private fun candidates(route: TrailRoute, closure: TrailRouteClosure): List<Candidate> {
        return joined(rawCandidates(route, closure))
    }

    /**
     * Consecutive polylines that meet end to start are one continuous geometry however the route happens to group it into
     * segments and edges, so they are judged as one.
     */
    private fun joined(candidates: List<Candidate>): List<Candidate> {
        val out = mutableListOf<Candidate>()
        candidates.forEach { next ->
            val previous = out.lastOrNull()
            if (previous != null && previous.known == next.known && previous.attributed == next.attributed && next.points.isNotEmpty() &&
                previous.points.isNotEmpty() &&
                TrailDistanceSijko.metersBetween(previous.points.last(), next.points.first()) <= JoinMeters
            ) {
                out[out.lastIndex] = Candidate(previous.points + next.points, previous.known, previous.attributed)
            } else {
                out += next
            }
        }
        return out
    }

    private fun rawCandidates(route: TrailRoute, closure: TrailRouteClosure): List<Candidate> {
        if (route.edges.isEmpty()) {
            // A route without per-edge provenance: its merged trail segments, judged by geometry alone.
            return route.segments
                .filter { it.type == TrailRouteSegmentType.Trail && TrailNetworkRole.SharedRoadways !in it.routeRoles }
                .map { Candidate(it.points, known = false, attributed = false) }
        }
        return route.edges
            // The closure's own feature, or an edge with no recorded source (a snap connector made along it).
            .filter { it.sourceFeatureId == closure.featureId || it.sourceFeatureId == null }
            .flatMap { edge ->
                val known = edge.sourceFeatureId == closure.featureId
                // Only trail travel: an access segment can inherit the enclosing trail edge's source id, and a mapped road
                // is not the closed trail whatever edge carries it.
                edge.routeSegments
                    .filter { it.type == TrailRouteSegmentType.Trail }
                    .map { Candidate(it.points, known, attributed = true) }
            }
    }

    /** A line to judge travel against, with the closure's interval (or crossing position) expressed on it. */
    private class Reference(val frame: TrailRouteSourceFrame, val low: Double, val high: Double)

    /**
     * The lines a candidate may travel on: the unchanged source line, and, for a leg of the closure's own feature, each
     * derived leg the current graph defines for the closure's source leg, with the interval transferred onto it by the
     * graph's own correspondence ([TrailRouteClosureDerivationSijko]). Nothing here projects the bounds onto a chord.
     */
    private fun references(candidate: Candidate, closure: TrailRouteClosure, derived: List<TrailRouteDerivedClosureLeg>?): List<Reference> {
        val own = frameOf(closure)?.let { frame -> intervalOf(frame, closure).let { Reference(frame, it.first, it.second) } }
        if (!candidate.known || derived == null) {
            return listOfNotNull(own)
        }
        val transferred = derived.filter { it.closureId == closure.id }.mapNotNull { leg ->
            TrailRouteSourceFrame(leg.from, leg.to).takeIf { it.length > 0.0 }?.let { Reference(it, leg.low, leg.high) }
        }
        return listOfNotNull(own) + transferred
    }

    /**
     * The unavailable-map fallback: does any leg of this attributed polyline come within the graph's reach of the closed
     * section's line (or of the crossing point)? Used only when no correspondence was supplied, and then it is the whole
     * judgement for attributed legs beyond the exact check on the source line.
     */
    private fun withinGraphReach(candidate: Candidate, closure: TrailRouteClosure): Boolean {
        if (!candidate.attributed) {
            return false
        }
        val section = closure.closedPath
        return candidate.points.zipWithNext().any { (start, end) ->
            if (closure.isCrossing) {
                TrailDistanceSijko.projectToSegment(closure.closedFrom, start, end).distanceMeters <= GraphReachMeters
            } else {
                section.zipWithNext().any { (from, to) -> segmentDistanceMeters(start, end, from, to) <= GraphReachMeters }
            }
        }
    }

    /** The smallest distance between two straight legs: zero when they cross, else the nearest end to the other leg. */
    private fun segmentDistanceMeters(a1: MapPoint, a2: MapPoint, b1: MapPoint, b2: MapPoint): Double {
        val cosLatitude = kotlin.math.cos(a1.latitude * kotlin.math.PI / 180.0)
        fun x(p: MapPoint) = (p.longitude - a1.longitude) * cosLatitude * TrailRouteSourceFrame.METERS_PER_DEGREE
        fun y(p: MapPoint) = (p.latitude - a1.latitude) * TrailRouteSourceFrame.METERS_PER_DEGREE
        fun cross(ox: Double, oy: Double, ax: Double, ay: Double, bx: Double, by: Double) = (ax - ox) * (by - oy) - (ay - oy) * (bx - ox)
        val d1 = cross(x(a1), y(a1), x(a2), y(a2), x(b1), y(b1))
        val d2 = cross(x(a1), y(a1), x(a2), y(a2), x(b2), y(b2))
        val d3 = cross(x(b1), y(b1), x(b2), y(b2), x(a1), y(a1))
        val d4 = cross(x(b1), y(b1), x(b2), y(b2), x(a2), y(a2))
        if (d1 * d2 < 0.0 && d3 * d4 < 0.0) {
            return 0.0
        }
        return minOf(
            TrailDistanceSijko.projectToSegment(a1, b1, b2).distanceMeters,
            TrailDistanceSijko.projectToSegment(a2, b1, b2).distanceMeters,
            TrailDistanceSijko.projectToSegment(b1, a1, a2).distanceMeters,
            TrailDistanceSijko.projectToSegment(b2, a1, a2).distanceMeters,
        )
    }

    /**
     * Does the route travel through the closure's crossing point on its feature? Touching the point counts (within the
     * crossing tolerance). On a derived leg the crossing's position is the one the graph's correspondence transfers.
     */
    private fun traversesCrossing(route: TrailRoute, closure: TrailRouteClosure, derived: List<TrailRouteDerivedClosureLeg>?): Boolean {
        return candidates(route, closure).any { candidate ->
            candidate.points.zipWithNext().any { (start, end) ->
                TrailDistanceSijko.projectToSegment(closure.closedFrom, start, end).distanceMeters <=
                    CrossingToleranceMeters
            } || references(candidate, closure, derived).any { reference ->
                candidate.points.zipWithNext().any { (start, end) -> spansPosition(reference.frame, start, end, reference.low, reference.high) }
            } || (derived == null && withinGraphReach(candidate, closure))
        }
    }

    /**
     * Positive travel ALONG the closed section: some run of legs of the route lies on the source line (or on a derived leg,
     * with the interval transferred onto it) and covers part of the interval. Any amount counts (a short route wholly
     * inside it, or a few meters past either bound), with numerical noise only. A perpendicular crossing, a junction hop
     * and an approach that ends at a bound have no leg on the line that overlaps the interval, so they are not travel
     * along the section. There is no error allowance: the line each leg is judged against is the line it lies on, and the
     * interval on it is the closure's own, transferred exactly.
     */
    private fun ridesClosedSection(route: TrailRoute, closure: TrailRouteClosure, derived: List<TrailRouteDerivedClosureLeg>?): Boolean {
        return candidates(route, closure).any { candidate ->
            references(candidate, closure, derived).any { reference ->
                travelsAlongPath(reference.frame, candidate.points, reference.low, reference.high, OnSectionLineToleranceMeters)
            } || (derived == null && withinGraphReach(candidate, closure))
        }
    }

    /** The line the closure sits on: its source leg, else its own section. Null when it has no extent. */
    private fun frameOf(closure: TrailRouteClosure): TrailRouteSourceFrame? {
        val line = closure.sourceLine.ifEmpty { closure.closedPath }
        if (line.size < 2) {
            return null
        }
        return TrailRouteSourceFrame(line.first(), line.last()).takeIf { it.length > 0.0 }
    }

    /** The section's interval in the frame's positions, lowest first. */
    private fun intervalOf(frame: TrailRouteSourceFrame, closure: TrailRouteClosure): Pair<Double, Double> {
        val from = frame.along(closure.closedFrom)
        val to = frame.along(closure.closedTo)
        return Pair(kotlin.math.min(from, to), kotlin.math.max(from, to))
    }

    /** A point strictly inside [low]..[high] along the line, within [tolerance] of it. */
    private fun insideInterval(frame: TrailRouteSourceFrame, point: MapPoint, low: Double, high: Double, tolerance: Double): Boolean {
        val position = frame.along(point)
        return frame.across(point) <= tolerance &&
            position > low + SectionOverlapEpsilonMeters && position < high - SectionOverlapEpsilonMeters
    }

    /**
     * The polyline travels along the line over more than numerical noise of [low]..[high]. The decision is made on each
     * maximal run of consecutive legs that lie on the line (within [tolerance], aligned) and sums the run's overlap, so
     * subdividing a continuous geometry into any number of collinear legs cannot change it, and geometry outside the
     * interval can never hide travel inside it: a leg contributes only its own overlap with the interval.
     */
    private fun travelsAlongPath(
        frame: TrailRouteSourceFrame,
        points: List<MapPoint>,
        low: Double,
        high: Double,
        tolerance: Double,
    ): Boolean {
        var overlap = 0.0
        points.zipWithNext().forEach { (start, end) ->
            // A repeated vertex has no direction and no length: it neither continues nor breaks a run.
            val alignment = frame.alignment(start, end) ?: return@forEach
            if (frame.across(start) > tolerance || frame.across(end) > tolerance || alignment < LongitudinalCosine) {
                if (overlap > SectionOverlapEpsilonMeters) {
                    return true
                }
                overlap = 0.0
                return@forEach
            }
            val a = frame.along(start)
            val b = frame.along(end)
            overlap += kotlin.math.max(
                0.0,
                kotlin.math.min(kotlin.math.max(a, b), high) - kotlin.math.max(kotlin.math.min(a, b), low),
            )
        }
        return overlap > SectionOverlapEpsilonMeters
    }

    /** The leg lies on the line and spans [position] (touching, within the crossing tolerance). */
    private fun spansPosition(
        frame: TrailRouteSourceFrame,
        start: MapPoint,
        end: MapPoint,
        low: Double,
        high: Double,
    ): Boolean {
        val alignment = frame.alignment(start, end) ?: return false
        if (frame.across(start) > OnSectionLineToleranceMeters || frame.across(end) > OnSectionLineToleranceMeters ||
            alignment < LongitudinalCosine
        ) {
            return false
        }
        val a = frame.along(start)
        val b = frame.along(end)
        return high >= kotlin.math.min(a, b) - CrossingToleranceMeters &&
            low <= kotlin.math.max(a, b) + CrossingToleranceMeters
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
