/**
 * Job: Carry one route the rider planned or reopened recently without saving it.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import kotlinx.serialization.Serializable

@Serializable
data class RecentTrailRoute(
    val id: String,
    val title: String,
    val route: TrailRoute,
    val lastUsedEpochMillis: Long,
)
