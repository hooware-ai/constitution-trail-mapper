/**
 * Job: Verify mapped safety hazards strongly penalize intersecting geometry without blocking nearby routes.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TrailRoutingHazardPenaltySijkoTest {
    @Test
    fun appliesFixedPenaltyWhenAnEdgeCrossesTheHazardRadius() {
        val hazard = hazard()
        val crossing = edge(
            MapPoint(40.47390608, -88.9685),
            MapPoint(40.47390608, -88.9670),
        )

        assertEquals(
            hazard.fixedPenalty,
            TrailRoutingHazardPenaltySijko.additionalCost(crossing, listOf(hazard)),
        )
        assertTrue(TrailEdgeWeightSijko.cost(crossing) > crossing.distanceMeters * 100.0)
        assertTrue(TrailRouteDistanceWeightSijko.cost(crossing) > crossing.distanceMeters * 100.0)
    }

    @Test
    fun leavesGeometryOutsideTheHazardRadiusUnchanged() {
        val nearby = edge(
            MapPoint(40.4750, -88.9685),
            MapPoint(40.4750, -88.9670),
        )

        assertEquals(0.0, TrailRoutingHazardPenaltySijko.additionalCost(nearby, listOf(hazard())))
    }

    @Test
    fun finalCandidateRatingCannotSelectAHazardousEqualDistanceRoute() {
        val hazardousEdge = edge(
            MapPoint(40.47390608, -88.9685),
            MapPoint(40.47390608, -88.9670),
        )
        val safeEdge = edge(
            MapPoint(40.4750, -88.9685),
            MapPoint(40.4750, -88.9670),
        )
        val start = MapPoint(40.47390608, -88.9685)
        val destination = MapPoint(40.47390608, -88.9670)

        assertTrue(
            TrailRouteRatingSijko.score(route(safeEdge), start, destination) <
                TrailRouteRatingSijko.score(route(hazardousEdge), start, destination),
        )
    }

    @Test
    fun sameCrossingCostsTheSameWhetherSplitIntoOneOrManyEdges() {
        val hazard = hazard()
        val start = MapPoint(40.47390608, -88.9685)
        val end = MapPoint(40.47390608, -88.9670)
        val single = listOf(edge(start, end))
        val splitOutsideRadius = chain(start, MapPoint(40.47390608, -88.9684), end)
        val splitInsideRadius = chain(
            start,
            MapPoint(40.47390608, -88.9682),
            MapPoint(40.47390608, -88.9677),
            MapPoint(40.47390608, -88.9672),
            end,
        )
        val splitEvenly = chain(
            *(0..30).map { step -> MapPoint(40.47390608, -88.9685 + 0.0015 * step / 30.0) }.toTypedArray(),
        )

        listOf(single, splitOutsideRadius, splitInsideRadius, splitEvenly).forEach { edges ->
            assertEquals(
                hazard.fixedPenalty,
                edges.sumOf { edge -> TrailRoutingHazardPenaltySijko.additionalCost(edge, listOf(hazard)) },
                "Split into ${edges.size} edges.",
            )
            assertEquals(
                hazard.fixedPenalty,
                TrailRoutingHazardPenaltySijko.routeCost(edges, listOf(hazard)),
                "Split into ${edges.size} edges.",
            )
            assertClose(
                single.sumOf(TrailEdgeWeightSijko::cost),
                edges.sumOf(TrailEdgeWeightSijko::cost),
            )
            assertClose(
                single.sumOf(TrailRouteDistanceWeightSijko::cost),
                edges.sumOf(TrailRouteDistanceWeightSijko::cost),
            )
            assertClose(
                TrailRouteRatingSijko.score(route(single), start, end),
                TrailRouteRatingSijko.score(route(edges), start, end),
            )
        }
        assertTrue(splitEvenly.all { edge -> TrailEdgeWeightSijko.cost(edge) >= 0.0 })
    }

    @Test
    fun routeCostChargesEveryVisitIncludingOnesThatStartOrEndInsideTheRadius() {
        val hazard = hazard()
        val west = MapPoint(40.47390608, -88.9685)
        val center = hazard.center
        val insideEast = MapPoint(40.47390608, -88.9676)
        val east = MapPoint(40.47390608, -88.9670)

        assertEquals(
            hazard.fixedPenalty,
            TrailRoutingHazardPenaltySijko.routeCost(chain(center, insideEast), listOf(hazard)),
        )
        assertEquals(
            hazard.fixedPenalty,
            TrailRoutingHazardPenaltySijko.routeCost(chain(center, east), listOf(hazard)),
        )
        assertEquals(
            hazard.fixedPenalty * 2.0,
            TrailRoutingHazardPenaltySijko.routeCost(chain(west, east, west), listOf(hazard)),
        )
        // Inside, out, and back inside is two separate visits.
        assertEquals(
            hazard.fixedPenalty * 2.0,
            TrailRoutingHazardPenaltySijko.routeCost(chain(center, east, insideEast), listOf(hazard)),
        )
        assertEquals(
            hazard.fixedPenalty * 2.0,
            TrailRoutingHazardPenaltySijko.routeCost(
                chain(center, MapPoint(40.47390608, -88.9660), MapPoint(40.47390608, -88.9665), insideEast),
                listOf(hazard),
            ),
        )
    }

    @Test
    fun edgeCostsPlusInsideEndpointHalvesMatchRouteCost() {
        val hazard = hazard()
        val center = hazard.center
        val insideEast = MapPoint(40.47390608, -88.9676)
        val east = MapPoint(40.47390608, -88.9670)
        val west = MapPoint(40.47390608, -88.9685)

        listOf(
            chain(west, east) to 0,
            chain(center, east) to 1,
            chain(center, east, insideEast) to 2,
            chain(center, insideEast) to 2,
        ).forEach { (edges, insideEndpoints) ->
            assertEquals(
                TrailRoutingHazardPenaltySijko.routeCost(edges, listOf(hazard)),
                edges.sumOf { edge -> TrailRoutingHazardPenaltySijko.additionalCost(edge, listOf(hazard)) } +
                    insideEndpoints * hazard.fixedPenalty / 2.0,
            )
        }
    }

    @Test
    fun entersFlagsAnEdgeWhollyInsideTheRadiusEvenThoughItCarriesNoCrossingCost() {
        val hazard = hazard()
        val insideOnly = edge(hazard.center, MapPoint(40.47390608, -88.9676))
        val crossing = edge(MapPoint(40.47390608, -88.9685), MapPoint(40.47390608, -88.9670))
        val nearby = edge(MapPoint(40.4750, -88.9685), MapPoint(40.4750, -88.9670))

        assertEquals(0.0, TrailRoutingHazardPenaltySijko.additionalCost(insideOnly, listOf(hazard)))
        assertTrue(TrailRoutingHazardPenaltySijko.enters(insideOnly, listOf(hazard)))
        assertTrue(TrailRoutingHazardPenaltySijko.enters(crossing, listOf(hazard)))
        assertFalse(TrailRoutingHazardPenaltySijko.enters(nearby, listOf(hazard)))
    }

    @Test
    fun routeCostPairsCrossingsAcrossAJunctionGapThatStraddlesTheRadius() {
        val hazard = hazard()
        // Edges from different features meet at a snapped node, not a shared vertex. The first edge
        // ends just inside the radius and the next starts just outside it.
        val entering = edge(MapPoint(40.47390608, -88.9690), MapPoint(40.47390608, -88.9683))
        val leaving = edge(MapPoint(40.47390608, -88.9685), MapPoint(40.47390608, -88.9700))

        assertEquals(
            hazard.fixedPenalty,
            TrailRoutingHazardPenaltySijko.routeCost(listOf(entering, leaving), listOf(hazard)),
        )
    }

    private fun hazard(): TrailRoutingHazard {
        return TrailRoutingHazard(
            id = "test-hazard",
            center = MapPoint(40.47390608, -88.96773407),
            radiusMeters = 55.0,
            fixedPenalty = 50_000.0,
        )
    }

    private fun edge(start: MapPoint, end: MapPoint): TrailGraphEdge {
        return TrailGraphEdge(
            id = 1,
            fromNodeId = 1,
            toNodeId = 2,
            distanceMeters = TrailDistanceSijko.metersBetween(start, end),
            routeRoles = setOf(TrailNetworkRole.SharedRoadways),
            facilityType = TrailFacilityType.SharedLane,
            routeSegments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(start, end),
                    routeRoles = setOf(TrailNetworkRole.SharedRoadways),
                ),
            ),
        )
    }

    private fun chain(vararg points: MapPoint): List<TrailGraphEdge> {
        return points.toList().windowed(size = 2, step = 1).mapIndexed { index, (start, end) ->
            edge(start, end).copy(id = index + 1, fromNodeId = index + 1, toNodeId = index + 2)
        }
    }

    private fun route(edge: TrailGraphEdge): TrailRoute = route(listOf(edge))

    private fun route(edges: List<TrailGraphEdge>): TrailRoute {
        val distanceMeters = edges.sumOf { edge -> edge.distanceMeters }
        return TrailRoute(
            edges = edges,
            segments = edges.flatMap { edge -> edge.routeSegments },
            totalDistanceMeters = distanceMeters,
            ordinaryAccessDistanceMeters = 0.0,
            sharedRoadwayDistanceMeters = distanceMeters,
            totalCost = 0.0,
        )
    }

    private fun assertClose(expected: Double, actual: Double) {
        assertTrue(abs(expected - actual) < 0.001, "Expected $expected but was $actual.")
    }
}
