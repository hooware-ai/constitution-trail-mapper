/**
 * Job: Identify whether a route connects two places or returns an exerciser to the start.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
enum class TrailRouteKind {
    Navigation,
    ExerciseLoop,
}
