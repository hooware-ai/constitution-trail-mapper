/**
 * Job: Verify constrained route results become readable route summaries.
 *
 */
package com.trailmapper.shared.routing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailRouteSummarySijkoTest {
    @Test
    fun summarizesExerciseRoutesWithDuration() {
        val route = TrailRoute(
            totalDistanceMeters = 8_046.72,
            ordinaryAccessDistanceMeters = 0.0,
            sharedRoadwayDistanceMeters = 0.0,
            totalCost = 8_046.72,
            kind = TrailRouteKind.ExerciseLoop,
            requestedDistanceMeters = 8_046.72,
        )

        assertEquals(
            "Exercise loop found: 5.0 mi, about 38 min at 8 mph.",
            TrailRouteSummarySijko.summaryFor(route),
        )
    }

    @Test
    fun exerciseSummaryReportsRetracedMileage() {
        val route = TrailRoute(
            totalDistanceMeters = 8_046.72,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 8_046.72,
            kind = TrailRouteKind.ExerciseLoop,
            requestedDistanceMeters = 8_046.72,
            traversalEdges = listOf(
                TrailRouteTraversalEdge("outbound", 1_609.344),
                TrailRouteTraversalEdge("return", 1_609.344),
                TrailRouteTraversalEdge("return", 1_609.344),
            ),
        )

        assertEquals(
            "Exercise loop found: 5.0 mi, about 38 min at 8 mph; 0.92 mi retraced.",
            TrailRouteSummarySijko.summaryFor(route),
        )
    }

    @Test
    fun reportsTrailAccessAndTotalMiles() {
        val summary = TrailRouteSummarySijko.summaryFor(
            TrailRoute(
                edges = emptyList(),
                totalDistanceMeters = 1609.344,
                ordinaryAccessDistanceMeters = 160.9344,
                totalCost = 0.0,
            ),
        )

        assertTrue(summary.contains("0.9 trail/connector miles"))
        assertTrue(summary.contains("0.1 access miles"))
        assertTrue(summary.contains("1.0 total miles"))
    }

    @Test
    fun reportsSharedRoadwayMilesWhenPresent() {
        val summary = TrailRouteSummarySijko.summaryFor(
            TrailRoute(
                edges = emptyList(),
                totalDistanceMeters = 1609.344,
                ordinaryAccessDistanceMeters = 160.9344,
                sharedRoadwayDistanceMeters = 402.336,
                totalCost = 0.0,
            ),
        )

        assertTrue(summary.contains("0.65 trail/connector miles"))
        assertTrue(summary.contains("0.25 shared-road miles"))
        assertTrue(summary.contains("0.1 access miles"))
        assertTrue(summary.contains("1.0 total miles"))
    }

}
