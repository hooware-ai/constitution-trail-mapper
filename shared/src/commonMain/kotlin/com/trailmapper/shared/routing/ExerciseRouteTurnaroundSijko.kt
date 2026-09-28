/**
 * Job: Count the physical turnarounds in an exercise route candidate, as riders will see them.
 *
 */
package com.trailmapper.shared.routing

object ExerciseRouteTurnaroundSijko {
    /**
     * Counts U-turns in the candidate's geometry, built the same way as the planned route, so a
     * dead-end turnaround made across two edges of one trail counts like one made on a single edge.
     */
    fun count(edges: List<TrailGraphEdge>): Int {
        return TrailRouteTraversalShapeSijko.reversalCount(
            TrailRouteSegmentMergeSijko.merge(edges.flatMap { edge -> edge.routeSegments }),
        )
    }
}
