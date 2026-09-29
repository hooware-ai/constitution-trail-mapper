/**
 * Job: Verify one coherent outward exploration beats compact and multi-arm route shapes.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExerciseRouteExplorationShapeSijkoTest {
    @Test
    fun coherentOutAndBackIsAllowedWhileMultipleDeparturesArePenalized() {
        val start = MapPoint(40.0, -89.0)
        val north = MapPoint(40.018, -89.0)
        val east = MapPoint(40.0, -88.976)
        val coherent = edge(listOf(start, north, start))
        val multiArm = edge(listOf(start, north, start, east, start))

        assertEquals(0.0, ExerciseRouteExplorationShapeSijko.penaltyMeters(listOf(coherent), start, 8_000.0))
        assertTrue(
            ExerciseRouteExplorationShapeSijko.penaltyMeters(listOf(multiArm), start, 8_000.0) > 2_000.0,
        )
    }

    @Test
    fun compactRouteReceivesAReachShortfallPenalty() {
        val start = MapPoint(40.0, -89.0)
        val compact = edge(listOf(start, MapPoint(40.003, -89.0), start))

        assertTrue(ExerciseRouteExplorationShapeSijko.penaltyMeters(listOf(compact), start, 8_000.0) > 0.0)
    }

    @Test
    fun secondRemoteTurnaroundIsPenalizedWhileOneOutAndBackRemainsAllowed() {
        val start = MapPoint(40.0, -89.0)
        val junction = MapPoint(40.0, -88.99)
        val west = MapPoint(40.0, -89.02)
        val south = MapPoint(39.98, -88.99)
        val stem = edge(1, "stem", start, junction)
        val westArm = edge(2, "west", junction, west)
        val southArm = edge(3, "south", junction, south)
        val oneTurnaround = listOf(stem, westArm, westArm.reversed(), stem.reversed())
        val twoTurnarounds = listOf(
            stem,
            westArm,
            westArm.reversed(),
            southArm,
            southArm.reversed(),
            stem.reversed(),
        )

        assertEquals(1, ExerciseRouteTurnaroundSijko.count(oneTurnaround))
        assertEquals(2, ExerciseRouteTurnaroundSijko.count(twoTurnarounds))
        assertTrue(
            ExerciseRouteExplorationShapeSijko.penaltyMeters(twoTurnarounds, start, 8_000.0) >
                ExerciseRouteExplorationShapeSijko.penaltyMeters(oneTurnaround, start, 8_000.0) + 5_000.0,
        )
    }

    @Test
    fun aDeadEndTurnaroundMadeAcrossTwoEdgesCounts() {
        val start = MapPoint(40.0, -89.0)
        val junction = MapPoint(40.0, -88.99)
        val nearTip = MapPoint(40.0, -88.975)
        val tip = MapPoint(40.0, -88.97)
        val beyond = MapPoint(39.99, -88.975)
        val stem = edge(1, "stem", start, junction)
        // Rides into the tip on one edge and back out on another that shares the final stretch.
        val intoTip = edge(2, "spur", listOf(junction, nearTip, tip))
        val outOfTip = edge(3, "spur", listOf(tip, nearTip, beyond))
        val secondArm = edge(4, "south", beyond, MapPoint(39.97, -88.975))
        val oneTurnaround = listOf(stem, intoTip, outOfTip)
        val twoTurnarounds = oneTurnaround + listOf(secondArm, secondArm.reversed())

        assertEquals(1, ExerciseRouteTurnaroundSijko.count(oneTurnaround))
        assertEquals(2, ExerciseRouteTurnaroundSijko.count(twoTurnarounds))
        assertTrue(
            ExerciseRouteExplorationShapeSijko.penaltyMeters(twoTurnarounds, start, 8_000.0) >
                ExerciseRouteExplorationShapeSijko.penaltyMeters(oneTurnaround, start, 8_000.0) + 5_000.0,
        )
    }

    private fun edge(id: Int, sourceFeatureId: String, points: List<MapPoint>): TrailGraphEdge {
        return TrailGraphEdge(
            id = id,
            fromNodeId = id,
            toNodeId = id + 1,
            distanceMeters = TrailDistanceSijko.pathLengthMeters(points),
            sourceFeatureId = sourceFeatureId,
            routeSegments = listOf(TrailRouteSegment(TrailRouteSegmentType.Trail, points)),
        )
    }

    private fun edge(points: List<MapPoint>): TrailGraphEdge {
        return TrailGraphEdge(
            id = 1,
            fromNodeId = 1,
            toNodeId = 2,
            distanceMeters = TrailDistanceSijko.pathLengthMeters(points),
            routeSegments = listOf(TrailRouteSegment(TrailRouteSegmentType.Trail, points)),
        )
    }

    private fun edge(
        id: Int,
        sourceFeatureId: String,
        start: MapPoint,
        end: MapPoint,
    ): TrailGraphEdge {
        return TrailGraphEdge(
            id = id,
            fromNodeId = id,
            toNodeId = id + 1,
            distanceMeters = TrailDistanceSijko.metersBetween(start, end),
            sourceFeatureId = sourceFeatureId,
            routeSegments = listOf(TrailRouteSegment(TrailRouteSegmentType.Trail, listOf(start, end))),
        )
    }

    private fun TrailGraphEdge.reversed(): TrailGraphEdge {
        return copy(
            fromNodeId = toNodeId,
            toNodeId = fromNodeId,
            routeSegments = routeSegments.asReversed().map { segment ->
                segment.copy(points = segment.points.asReversed())
            },
        )
    }
}
