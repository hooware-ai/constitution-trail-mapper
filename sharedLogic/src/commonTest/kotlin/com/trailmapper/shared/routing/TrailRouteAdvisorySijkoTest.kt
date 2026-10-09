/**
 * Job: Keep approximate construction notices from becoming false closures or automatic reopenings.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailRouteAdvisorySijkoTest {
    @Test
    fun warnsForTheMappedHamiltonRoadWithoutAlteringTheRoute() {
        val route = route("W Hamilton Rd")
        val before = Json.encodeToString(TrailRoute.serializer(), route)

        val advisory = TrailRouteAdvisorySijko.forRoute(route, September7).single()

        assertEquals("hamilton-rhodes-2026-08-17", advisory.id)
        assertTrue(advisory.message.contains("512 and 519"))
        assertTrue(advisory.message.contains("has not been detoured"))
        assertEquals(before, Json.encodeToString(TrailRoute.serializer(), route))
    }

    @Test
    fun recognizesNamesAndUnnamedSourceEdgesInSavedRoutes() {
        val namedRoute = route(" E. Hamilton Road ")
        assertEquals(1, TrailRouteAdvisorySijko.forRoute(namedRoute, September7).size)

        val original = route(name = null).copy(
            edges = listOf(
                TrailGraphEdge(
                    id = 0,
                    fromNodeId = 0,
                    toNodeId = 1,
                    distanceMeters = 200.0,
                    ordinaryAccessDistanceMeters = 200.0,
                    accessRoadClass = "S1400",
                    sourceFeatureId = "8:3333226",
                    routeSegments = listOf(segment(name = null)),
                ),
            ),
        )
        val reopenedRoute = Json.decodeFromString(
            TrailRoute.serializer(),
            Json.encodeToString(TrailRoute.serializer(), original),
        )
        assertEquals(1, TrailRouteAdvisorySijko.forRoute(reopenedRoute, September7).size)
    }

    @Test
    fun doesNotMarkAParallelTrailAnUnrelatedRoadOrAnEstimatedConnectorClosed() {
        val parallelTrail = route("Hamilton Road").copy(
            segments = listOf(segment("Hamilton Road").copy(type = TrailRouteSegmentType.Trail)),
        )
        val estimatedConnector = route("Hamilton Rd").copy(
            segments = listOf(segment("Hamilton Rd").copy(isRouted = false)),
        )

        assertTrue(TrailRouteAdvisorySijko.forRoute(parallelTrail, September7).isEmpty())
        assertTrue(TrailRouteAdvisorySijko.forRoute(route("Hershey Rd"), September7).isEmpty())
        assertTrue(TrailRouteAdvisorySijko.forRoute(estimatedConnector, September7).isEmpty())
    }

    @Test
    fun leavesTheSeparateHamiltonRoadAlignmentOutsideTheAdvisory() {
        val northAlignment = route("E Hamilton Rd").copy(
            segments = listOf(
                segment("E Hamilton Rd").copy(
                    points = listOf(
                        MapPoint(latitude = 40.4544, longitude = -88.9680),
                        MapPoint(latitude = 40.4544, longitude = -88.9630),
                    ),
                ),
            ),
        )

        assertTrue(TrailRouteAdvisorySijko.forRoute(northAlignment, September7).isEmpty())
    }

    @Test
    fun neverTreatsTheEstimatedCompletionAsAConfirmedReopening() {
        val warning = TrailRouteAdvisorySijko.forRoute(route("Rhodes Ln"), October1).single()

        assertTrue(warning.message.contains("Completion is estimated"))
        assertTrue(warning.message.contains("an estimate does not confirm reopening"))
        assertTrue(warning.message.contains("last checked September 7, 2026"))
        assertTrue(warning.message.contains("object 841"))
        val afterEstimate = TrailRouteAdvisorySijko.forRoute(route("Rhodes Ln"), 1_793_487_600_001L).single()
        assertTrue(afterEstimate.message.contains("has passed; reopening has not been confirmed"))
        assertEquals(
            1,
            TrailRouteAdvisorySijko.approximateCorridors(October1).count { it.advisoryId.startsWith("hamilton") },
        )
    }

    @Test
    fun doesNotActivateTheWarningOrOverlayBeforeTheClosureStarts() {
        assertTrue(TrailRouteAdvisorySijko.forRoute(route("Rhodes Ln"), BeforeClosure).isEmpty())
        assertTrue(TrailRouteAdvisorySijko.approximateCorridors(BeforeClosure).isEmpty())
    }

    @Test
    fun labelsThePublishedLineAsAnApproximateWorkCorridor() {
        val corridor = TrailRouteAdvisorySijko.approximateCorridors(September7).single()

        assertTrue(corridor.label.contains("approximate"))
        assertTrue(corridor.label.contains("not exact closure limits"))
        assertEquals(-88.9813226624867, corridor.points.first().longitude)
        assertEquals(40.4513485856116, corridor.points.last().latitude)
        assertEquals(TrailRouteAdvisorySijko.LatestClosureMapUrl, corridor.sourceUrl)
    }

    @Test
    fun warnsForTrailTravelThroughTheUptownClosureWithoutAlteringTheRoute() {
        val route = trailRoute(
            vernon,
            MapPoint(latitude = 40.506383, longitude = -88.984091),
            phoenixCrossing,
            MapPoint(latitude = 40.507719, longitude = -88.983807),
            MapPoint(latitude = 40.508589, longitude = -88.983823),
            MapPoint(latitude = 40.508798, longitude = -88.983965),
            circleEntry,
        )

        val warning = TrailRouteAdvisorySijko.forRoute(route, September27).single()

        assertTrue(warning.title.contains("Uptown"))
        assertTrue(warning.message.contains("Phoenix Avenue to Broadway Avenue"))
        assertTrue(warning.message.contains("north sidewalk of Beaufort Street"))
        assertTrue(warning.message.contains("dismount and walk your bike"))
        assertTrue(warning.message.contains("This route has not been detoured"))
        assertEquals("https://www.normalil.gov/m/newsflash/Home/Detail/3337", warning.sourceUrl)
        assertEquals(route.segments, trailRoute(
            vernon,
            MapPoint(latitude = 40.506383, longitude = -88.984091),
            phoenixCrossing,
            MapPoint(latitude = 40.507719, longitude = -88.983807),
            MapPoint(latitude = 40.508589, longitude = -88.983823),
            MapPoint(latitude = 40.508798, longitude = -88.983965),
            circleEntry,
        ).segments)
    }

    @Test
    fun doesNotWarnForCrossingStreetsOrTrailOutsideTheUptownClosure() {
        val phoenixAvenue = TrailRoute(
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    name = "Phoenix Ave",
                    points = listOf(
                        MapPoint(latitude = 40.507699, longitude = -88.979927),
                        MapPoint(latitude = 40.507599, longitude = -88.984052),
                        MapPoint(latitude = 40.507561, longitude = -88.985759),
                    ),
                ),
            ),
            totalDistanceMeters = 500.0,
            ordinaryAccessDistanceMeters = 500.0,
            totalCost = 500.0,
        )
        val southOfPhoenix = trailRoute(vernon, MapPoint(latitude = 40.507593, longitude = -88.984200))
        val collegiateToVernon = trailRoute(
            MapPoint(latitude = 40.507508, longitude = -88.984580),
            MapPoint(latitude = 40.507561, longitude = -88.984195),
            vernon,
        )

        listOf(phoenixAvenue, southOfPhoenix, collegiateToVernon).forEach { route ->
            assertTrue(TrailRouteAdvisorySijko.forRoute(route, September27).isEmpty())
        }
    }

    @Test
    fun uptownAdvisoryStartsSeptember21AndHasNoAssumedReopening() {
        val route = trailRoute(phoenixCrossing, MapPoint(latitude = 40.508589, longitude = -88.983823), circleEntry)

        assertTrue(TrailRouteAdvisorySijko.forRoute(route, September20).isEmpty())
        assertTrue(TrailRouteAdvisorySijko.approximateCorridors(September20).none { it.advisoryId.startsWith("uptown") })
        val farFuture = 1_845_000_000_000L // 2028-06-19, past the June 2028 construction target
        val warning = TrailRouteAdvisorySijko.forRoute(route, farFuture).single()
        assertTrue(warning.message.contains("construction target does not confirm a reopening"))
        val corridor = TrailRouteAdvisorySijko.approximateCorridors(farFuture).single { it.advisoryId.startsWith("uptown") }
        assertTrue(corridor.label.contains("not exact closure limits"))
        assertEquals(phoenixCrossing, corridor.points.first())
        assertEquals(circleEntry, corridor.points.last())
    }

    private fun trailRoute(vararg points: MapPoint) = TrailRoute(
        segments = listOf(
            TrailRouteSegment(type = TrailRouteSegmentType.Trail, name = "Route 66 & Illinois Central", points = points.toList()),
        ),
        totalDistanceMeters = TrailDistanceSijko.pathLengthMeters(points.toList()),
        ordinaryAccessDistanceMeters = 0.0,
        totalCost = TrailDistanceSijko.pathLengthMeters(points.toList()),
    )

    private val vernon = MapPoint(latitude = 40.504950, longitude = -88.983974)
    private val phoenixCrossing = MapPoint(latitude = 40.507656, longitude = -88.984202)
    private val circleEntry = MapPoint(latitude = 40.509023, longitude = -88.984155)

    private fun route(name: String?) = TrailRoute(
        segments = listOf(segment(name)),
        totalDistanceMeters = 200.0,
        ordinaryAccessDistanceMeters = 200.0,
        totalCost = 200.0,
    )

    private fun segment(name: String?) = TrailRouteSegment(
        type = TrailRouteSegmentType.Access,
        name = name,
        points = listOf(
            MapPoint(latitude = 40.45132199983461, longitude = -88.97905500029931),
            MapPoint(latitude = 40.45133099984453, longitude = -88.9771480000203),
        ),
    )

    private companion object {
        const val BeforeClosure = 1_786_967_999_999L
        const val September7 = 1_788_782_400_000L
        const val October1 = 1_790_856_000_000L
        const val September20 = 1_789_905_600_000L
        const val September27 = 1_790_528_400_000L
    }
}
