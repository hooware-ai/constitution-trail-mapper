/**
 * Job: Remove officially closed trail sections from new route searches while their closures are active.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailRouteClosure(
    val id: String,
    val title: String,
    /** Rider guidance shown when no route can avoid the closure. */
    val guidance: String,
    val noticeUrl: String,
    val featureId: String,
    /** Path vertices bounding the closed section; the trail between them is removed. */
    val closedFrom: MapPoint,
    val closedTo: MapPoint,
    val activeFromEpochMillis: Long,
    /**
     * The notice's estimated completion. It is information for the rider and never lifts a closure: reopening needs an
     * official status update that has been reviewed, so a closure stays in force after this instant.
     */
    val estimatedEndEpochMillis: Long? = null,
    /**
     * True when [closedFrom]/[closedTo] are positions inside a source leg (the official map line projected onto the
     * county trail), not source vertices. The closed section is then cut out at those positions at run time, from the
     * unchanged source path, and the rest of every touched leg stays open.
     */
    val boundsProjected: Boolean = false,
    /** The closed section as a polyline, for projected bounds only valid when both bounds lie in ONE source leg. */
    val closedPath: List<MapPoint> = listOf(closedFrom, closedTo),
    /** Where the interval comes from and how approximate it is; empty when the bounds are source vertices. */
    val mappingNote: String = "",
    /** When the schedule was last checked against the official notice, for display. */
    val checkedOn: String = "",
    /**
     * True when the notice closes the trail AT a known crossing but publishes no limits along the trail. [closedFrom]
     * and [closedTo] are then both the crossing point and nothing is cut (no interval is invented): the closure only
     * gates a route that actually travels through the crossing on [featureId], from its start, and the router does not
     * plan around it, so such a route can be previewed but not started.
     */
    val isCrossing: Boolean = false,
)

object TrailRouteClosureSijko {
    // Town of Normal, September 14, 2026: Constitution Trail detoured around the Underpass
    // construction from September 21. No end date: a construction target is not a reopening,
    // so lift this only after an official reopening notice has been reviewed.
    val uptownUnderpass = TrailRouteClosure(
        id = "uptown-underpass-detour-2026-09-21",
        title = "No route avoids the Uptown trail closure",
        guidance = "Constitution Trail is closed through the Uptown Underpass construction zone, from Phoenix Avenue " +
            "to Uptown Circle. The Town of Normal detours it: west on Phoenix Avenue to Broadway Avenue, north on " +
            "Broadway to the north sidewalk of Beaufort Street, then east on Beaufort to Uptown Circle and the " +
            "trailhead north of it. On Uptown sidewalks, dismount and walk your bike; in the street, follow traffic " +
            "up Beaufort and around Uptown Circle. Trail Mapper does not route this detour.",
        noticeUrl = "https://www.normalil.gov/m/newsflash/Home/Detail/3337",
        featureId = "54:1305",
        closedFrom = MapPoint(latitude = 40.507656, longitude = -88.984202),
        closedTo = MapPoint(latitude = 40.509023, longitude = -88.984155),
        activeFromEpochMillis = 1_789_966_800_000L,
    )

    // Town of Normal notice 3356, posted October 2, 2026: Constitution Trail Illinois Central Branch closed between
    // Locust Street and Cypress Avenue from 6 a.m. Monday, October 5 to rebuild the Willow Street trail crossing,
    // completion estimated 5 p.m. Monday, October 19 (weather permitting). The official city map line (object 919)
    // is projected onto county trail feature 54:1305, path 0, inside the 790 m source leg between vertices 97 and
    // 98. The two projected positions are 202.5 m apart; they are neither surveyed barricades nor source vertices,
    // and the unchanged source leg keeps both of its remaining portions open.
    val willowTrailCrossing = TrailRouteClosure(
        id = "willow-trail-crossing-2026-10-05",
        title = "No route avoids the Willow Street trail closure",
        guidance = "Constitution Trail's Illinois Central Branch is closed between Locust Street and Cypress Avenue " +
            "while the Willow Street trail crossing is rebuilt (Town of Normal notice, posted October 2, 2026). " +
            "The Town's detour for the trail is Fell Avenue, via Locust Street and Cypress Street; its notice " +
            "calls the closure boundary Cypress Avenue and the detour street Cypress Street. Access to private " +
            "walks north of Locust Street is to be maintained. Trail Mapper does not route this detour. " +
            "The Town estimates completion by 5 p.m. CDT on Monday, October 19, weather permitting; an estimate " +
            "does not confirm reopening.",
        noticeUrl = "https://www.normalil.gov/m/newsflash/home/detail/3356",
        featureId = "54:1305",
        closedFrom = MapPoint(latitude = 40.5131086201, longitude = -88.9846643109),
        closedTo = MapPoint(latitude = 40.5149242085, longitude = -88.9848171673),
        activeFromEpochMillis = 1_791_198_000_000L,
        estimatedEndEpochMillis = 1_792_447_200_000L,
        boundsProjected = true,
        mappingNote = "Approximate: the Town's online closure map line (object 919) projected onto the county " +
            "trail, about 202 m. Not surveyed barricade locations.",
        checkedOn = "October 2, 2026",
    )

    // Town of Normal notice 3353, posted September 30, 2026: Constitution Trail is closed at Virginia Avenue (Camelback
    // Bridge) from 8 a.m. Monday, October 5, completion estimated 5 p.m. Tuesday, October 6 (weather permitting). The
    // notice gives no trail detour and no north/south limits, and the city map line for it (object 916) is a ROAD line,
    // so the only supported fact is the crossing itself: where that line meets county trail 54:1305 (leg 6 to 7 of
    // path 0). No interval is cut and no road or neighboring trail is closed.
    val camelbackCrossing = TrailRouteClosure(
        id = "camelback-virginia-trail-crossing-2026-10-05",
        title = "The trail is closed at Virginia Avenue (Camelback Bridge)",
        guidance = "The Town of Normal closed Constitution Trail at Virginia Avenue (Camelback Bridge) from 8 a.m. " +
            "CDT on Monday, October 5, 2026, with Virginia Avenue closed between South Linden and Hillcrest Streets " +
            "for bridge inspection and maintenance. The notice gives no trail detour and no closure limits along " +
            "the trail, so Trail Mapper cannot plan around it and does not start a route that crosses there. The " +
            "Town estimates completion by 5 p.m. CDT on Tuesday, October 6, weather permitting; an estimate does " +
            "not confirm reopening. Follow the Town's posted signs.",
        noticeUrl = "https://www.normalil.gov/m/newsflash/Home/Detail/3353",
        featureId = "54:1305",
        closedFrom = MapPoint(latitude = 40.4982689784, longitude = -88.9834162490),
        closedTo = MapPoint(latitude = 40.4982689784, longitude = -88.9834162490),
        activeFromEpochMillis = 1_791_205_200_000L,
        estimatedEndEpochMillis = 1_791_324_000_000L,
        mappingNote = "The crossing point is where the Town's Virginia Avenue closure line meets the county trail. " +
            "The closure's limits along the trail are not published and are not drawn or assumed.",
        checkedOn = "October 2, 2026",
        isCrossing = true,
    )

    val closures: List<TrailRouteClosure> = listOf(uptownUnderpass, willowTrailCrossing, camelbackCrossing)

    fun activeClosures(nowEpochMillis: Long): List<TrailRouteClosure> {
        return closures.filter { closure -> nowEpochMillis >= closure.activeFromEpochMillis }
    }

    /** [features] with every active closure's section cut out, plus the closures that matched. */
    fun openFeatures(
        features: List<TrailNetworkFeature>,
        nowEpochMillis: Long,
    ): ClosedNetwork {
        val active = activeClosures(nowEpochMillis)
        if (active.isEmpty()) {
            return ClosedNetwork(features, emptyList())
        }
        val applied = mutableSetOf<TrailRouteClosure>()
        val open = features.map { feature ->
            // A crossing-only closure cuts nothing: it has no interval, only a gate on routes that traverse it.
            val closuresForFeature = active.filter { it.featureId == feature.id && !it.isCrossing }
            if (closuresForFeature.isEmpty()) {
                return@map feature
            }
            var paths = feature.paths
            closuresForFeature.forEach { closure ->
                paths = paths.flatMap { path ->
                    val cut = if (closure.boundsProjected) cutAtProjectedBounds(path, closure) else cut(path, closure)
                    if (cut != null) {
                        applied += closure
                    }
                    cut ?: listOf(path)
                }
            }
            feature.copy(paths = paths)
        }
        return ClosedNetwork(open, active.filter { it in applied })
    }

    /** Splits [path] around the closed section, keeping both bounding vertices as open ends. */
    private fun cut(path: List<MapPoint>, closure: TrailRouteClosure): List<List<MapPoint>>? {
        val fromIndex = path.indexOfFirst { TrailDistanceSijko.metersBetween(it, closure.closedFrom) <= VertexMatchMeters }
        val toIndex = path.indexOfFirst { TrailDistanceSijko.metersBetween(it, closure.closedTo) <= VertexMatchMeters }
        if (fromIndex < 0 || toIndex < 0 || fromIndex == toIndex) {
            return null
        }
        val first = minOf(fromIndex, toIndex)
        val last = maxOf(fromIndex, toIndex)
        return listOf(path.subList(0, first + 1), path.subList(last, path.size)).filter { it.size >= 2 }
    }

    /**
     * Splits [path] at the closure's projected bounds, which lie inside source legs. Everything before the first bound
     * and after the second stays, ending exactly at the bound; the section between is removed. Nothing is invented
     * apart from those two positions, which are on the source line.
     */
    private fun cutAtProjectedBounds(path: List<MapPoint>, closure: TrailRouteClosure): List<List<MapPoint>>? {
        val fromAt = locate(path, closure.closedFrom) ?: return null
        val toAt = locate(path, closure.closedTo) ?: return null
        val (first, last) = if (fromAt.position <= toAt.position) Pair(fromAt, toAt) else Pair(toAt, fromAt)
        if (last.position <= first.position) {
            return null
        }
        // The stored bounds are the cut points themselves (they lie on the source line), so the cut is exact and repeatable.
        val before = path.subList(0, first.leg + 1) + first.point
        val after = listOf(last.point) + path.subList(last.leg + 1, path.size)
        return listOf(before.withoutRepeats(), after.withoutRepeats()).filter { it.size >= 2 }
    }

    /** The drawable closed section of [path]: the two bounds and every source vertex between them, or null. */
    fun closedSection(path: List<MapPoint>, closure: TrailRouteClosure): List<MapPoint>? {
        val fromAt = locate(path, closure.closedFrom) ?: return null
        val toAt = locate(path, closure.closedTo) ?: return null
        val (first, last) = if (fromAt.position <= toAt.position) Pair(fromAt, toAt) else Pair(toAt, fromAt)
        if (last.position <= first.position) {
            return null
        }
        val inner = path.subList(first.leg + 1, last.leg + 1)
        return (listOf(first.point) + inner + last.point).withoutRepeats()
    }

    private class Located(val leg: Int, val position: Double, val point: MapPoint)

    /** The nearest place on [path] to [point], when it is within [ProjectionToleranceMeters] of the line. */
    private fun locate(path: List<MapPoint>, point: MapPoint): Located? {
        var best: Located? = null
        var bestDistance = Double.MAX_VALUE
        for (leg in 0 until path.lastIndex) {
            val projection = TrailDistanceSijko.projectToSegment(point, path[leg], path[leg + 1])
            if (projection.distanceMeters < bestDistance) {
                val length = projection.distanceFromStartMeters + projection.distanceToEndMeters
                val fraction = if (length <= 0.0) 0.0 else projection.distanceFromStartMeters / length
                bestDistance = projection.distanceMeters
                best = Located(leg, leg + fraction, point)
            }
        }
        return best?.takeIf { bestDistance <= ProjectionToleranceMeters }
    }

    private fun List<MapPoint>.withoutRepeats(): List<MapPoint> {
        val out = mutableListOf<MapPoint>()
        forEach { point ->
            if (out.isEmpty() || TrailDistanceSijko.metersBetween(out.last(), point) > 0.01) out += point
        }
        return out
    }

    data class ClosedNetwork(
        val features: List<TrailNetworkFeature>,
        /** Active closures whose section was found and removed from [features]. */
        val appliedClosures: List<TrailRouteClosure>,
    )

    private const val VertexMatchMeters = 1.0

    /** The projected bounds are stored on the line itself; this only absorbs rounding. */
    private const val ProjectionToleranceMeters = 2.0
}
