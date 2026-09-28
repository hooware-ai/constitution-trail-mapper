/**
 * Job: Carry one locally saved trail route with display metadata and drawable route geometry.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import kotlinx.serialization.Serializable

@Serializable
data class SavedTrailRoute(
    val id: String,
    val title: String,
    val summary: String,
    val route: TrailRoute,
)
