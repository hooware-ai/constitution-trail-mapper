/**
 * Job: Carry one completed exercise navigation for future route-diversity scoring.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRouteTraversalEdge
import kotlinx.serialization.Serializable

@Serializable
data class CompletedExerciseSession(
    val id: String,
    val routeKey: String,
    val completedAtEpochMillis: Long,
    val completedDistanceMeters: Double,
    val traversalEdges: List<TrailRouteTraversalEdge>,
)
