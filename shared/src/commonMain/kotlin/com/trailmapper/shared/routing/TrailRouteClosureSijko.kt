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

    val closures: List<TrailRouteClosure> = listOf(uptownUnderpass)

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
            val closuresForFeature = active.filter { it.featureId == feature.id }
            if (closuresForFeature.isEmpty()) {
                return@map feature
            }
            var paths = feature.paths
            closuresForFeature.forEach { closure ->
                paths = paths.flatMap { path ->
                    val cut = cut(path, closure)
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

    data class ClosedNetwork(
        val features: List<TrailNetworkFeature>,
        /** Active closures whose section was found and removed from [features]. */
        val appliedClosures: List<TrailRouteClosure>,
    )

    private const val VertexMatchMeters = 1.0
}
