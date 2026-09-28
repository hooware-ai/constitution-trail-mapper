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
    private const val HamiltonEstimatedEndEpochMillis = 1_790_809_200_000L
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
        return listOfNotNull(hamiltonAdvisory(route, nowEpochMillis), uptownAdvisory(route, nowEpochMillis))
    }

    private fun hamiltonAdvisory(route: TrailRoute, nowEpochMillis: Long): TrailRouteAdvisory? {
        if (nowEpochMillis < HamiltonClosureStartEpochMillis || !usesHamiltonWorkCorridor(route)) {
            return null
        }
        val schedule = if (nowEpochMillis > HamiltonEstimatedEndEpochMillis) {
            "September 30, 2026 was an estimated completion date; reopening has not been confirmed."
        } else {
            "Completion is estimated for September 30, 2026; that date does not confirm reopening."
        }
        return TrailRouteAdvisory(
            id = HamiltonAdvisoryId,
            title = "Hamilton/Rhodes closure advisory",
            message = "This route uses the Hamilton/Rhodes work corridor. The city notice, " +
                "last checked September 7, 2026, reports an all-traffic closure between " +
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
