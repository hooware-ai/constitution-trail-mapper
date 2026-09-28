/**
 * Job: Verify ride history survives upstream id renumbering and small geometry edits without matching other roads.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExerciseRouteHistoryIndexTest {
    @Test
    fun renumberedSourceWithUnchangedGeometryKeepsIdenticalOverlap() {
        val recorded = listOf(edge("8:100", south, middle), edge("8:101", middle, north))
        val renumbered = listOf(edge("8:5100", south, middle), edge("8:5101", middle, north))

        val baseline = overlap(current = recorded, history = recorded)
        assertTrue(baseline > 0.0)
        assertEquals(baseline, overlap(current = renumbered, history = recorded))
    }

    @Test
    fun resplitRoadStillMatchesItsHistory() {
        val recorded = listOf(edge("8:100", south, north))
        val resplit = listOf(edge("8:7", south, middle), edge("8:8", middle, north))

        val baseline = overlap(current = recorded, history = recorded)
        assertEquals(baseline, overlap(current = resplit, history = recorded), baseline * 0.02)
    }

    @Test
    fun slightlyRedigitizedRoadStillMatchesItsHistory() {
        val recorded = listOf(edge("54:61", south, north))
        // About 3 m east, with an extra vertex the refreshed source added mid-road.
        val shift = 0.00004
        val redigitized = listOf(
            edge(
                "54:61",
                MapPoint(south.latitude, south.longitude + shift),
                MapPoint(middle.latitude, middle.longitude + shift * 1.5),
                MapPoint(north.latitude, north.longitude + shift),
            ),
        )

        val baseline = overlap(current = recorded, history = recorded)
        assertTrue(overlap(current = redigitized, history = recorded) > baseline * 0.95)
    }

    @Test
    fun redigitizedRoadRiddenTwiceRetainsHistoryOverlap() {
        val recorded = edge("54:61", south, north)
        val shift = 0.00004
        val redigitized = edge(
            "54:9061",
            MapPoint(south.latitude, south.longitude + shift),
            MapPoint(north.latitude, north.longitude + shift),
        )

        val baseline = overlap(current = listOf(recorded, recorded), history = listOf(recorded, recorded))
        val refreshed = overlap(current = listOf(redigitized, redigitized), history = listOf(recorded, recorded))
        assertTrue(refreshed > baseline * 0.95, "Expected repeated traversal overlap near $baseline, got $refreshed")
    }

    @Test
    fun redigitizedRoadRiddenOnceDoesNotCreditTwoCurrentTraversals() {
        val recorded = edge("54:61", south, north)
        val shift = 0.00004
        val redigitized = edge(
            "54:9061",
            MapPoint(south.latitude, south.longitude + shift),
            MapPoint(north.latitude, north.longitude + shift),
        )

        val baseline = overlap(current = listOf(recorded, recorded), history = listOf(recorded))
        val refreshed = overlap(current = listOf(redigitized, redigitized), history = listOf(recorded))
        assertEquals(baseline, refreshed, baseline * 0.02)
    }

    @Test
    fun parallelRoadThirtyMetersAwayDoesNotMatch() {
        val recorded = listOf(edge("8:100", south, north))
        val offset = 0.00035
        val parallel = listOf(
            edge("8:200", MapPoint(south.latitude, south.longitude + offset), MapPoint(north.latitude, north.longitude + offset)),
        )

        assertEquals(0.0, overlap(current = parallel, history = recorded))
    }

    @Test
    fun crossingRoadDoesNotMatch() {
        val recorded = listOf(edge("8:100", south, north))
        val crossing = listOf(
            edge(
                "8:300",
                MapPoint(middle.latitude, middle.longitude - 0.003),
                MapPoint(middle.latitude, middle.longitude + 0.003),
            ),
        )

        assertEquals(0.0, overlap(current = crossing, history = recorded))
    }

    @Test
    fun continuingPastTheEndOfARiddenRoadBarelyMatches() {
        val recorded = listOf(edge("8:100", south, middle))
        val continuation = listOf(edge("8:101", middle, north))

        val continuationOverlap = overlap(current = continuation, history = recorded)
        assertTrue(continuationOverlap < overlap(current = continuation, history = continuation) * 0.02)
    }

    @Test
    fun sessionKeysSavedInTheCurrentFormatStillMatch() {
        val savedKey = "54:61#400000000,-890000000;400040000,-890000000"
        val current = edge("54:9061", MapPoint(40.0, -89.0), MapPoint(40.004, -89.0))
        assertEquals(savedKey, ExerciseRouteTraversalSijko.keyFor(current.copy(sourceFeatureId = "54:61")))
        val saved = CompletedExerciseSession(
            id = "saved",
            routeKey = "exercise:$savedKey:444780",
            completedAtEpochMillis = now,
            completedDistanceMeters = 444.78,
            traversalEdges = listOf(TrailRouteTraversalEdge(savedKey, current.distanceMeters)),
        )

        val traversal = ExerciseRouteTraversalSijko.traversalFor(listOf(current))
        assertEquals(
            ExerciseRouteOverlapSijko.historyOverlapMeters(traversal, listOf(saved.copy(traversalEdges = traversal)), now),
            ExerciseRouteOverlapSijko.historyOverlapMeters(traversal, listOf(saved), now),
        )
        assertTrue(ExerciseRouteHistoryEdgeCostSijko.costsByEdgeId(listOf(current), listOf(saved), now).isNotEmpty())
    }

    private fun overlap(current: List<TrailGraphEdge>, history: List<TrailGraphEdge>): Double {
        return ExerciseRouteOverlapSijko.historyOverlapMeters(
            traversalEdges = ExerciseRouteTraversalSijko.traversalFor(current),
            completedSessions = listOf(
                CompletedExerciseSession(
                    id = "ride",
                    routeKey = "ride",
                    completedAtEpochMillis = now,
                    completedDistanceMeters = history.sumOf { it.distanceMeters },
                    traversalEdges = ExerciseRouteTraversalSijko.traversalFor(history),
                ),
            ),
            nowEpochMillis = now,
        )
    }

    private fun edge(source: String, vararg points: MapPoint): TrailGraphEdge {
        return TrailGraphEdge(
            id = 0,
            fromNodeId = 0,
            toNodeId = 1,
            distanceMeters = TrailDistanceSijko.pathLengthMeters(points.toList()),
            sourceFeatureId = source,
            routeSegments = listOf(TrailRouteSegment(type = TrailRouteSegmentType.Trail, points = points.toList())),
        )
    }

    private val south = MapPoint(40.0, -89.0)
    private val middle = MapPoint(40.004, -89.0)
    private val north = MapPoint(40.008, -89.0)
    private val now = 1_700_000_000_000L
}
