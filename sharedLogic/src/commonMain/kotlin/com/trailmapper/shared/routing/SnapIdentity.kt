/**
 * Job: Identify one physical projected endpoint snap within a source feature.
 *
 */
package com.trailmapper.shared.routing

internal data class SnapIdentity(
    val sourceFeatureKey: String,
    val latitude: Double,
    val longitude: Double,
)
