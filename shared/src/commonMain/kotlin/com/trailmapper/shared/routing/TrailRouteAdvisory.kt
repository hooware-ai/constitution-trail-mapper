/**
 * Job: Explain a source-backed condition relevant to a route without implying automatic avoidance.
 *
 */
package com.trailmapper.shared.routing

data class TrailRouteAdvisory(
    val id: String,
    val title: String,
    val message: String,
    val sourceUrl: String,
    val locationDescription: String,
)
