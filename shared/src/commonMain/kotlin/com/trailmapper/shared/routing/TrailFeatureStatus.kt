/**
 * Job: Name whether a trail-network feature is usable now or only proposed.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
enum class TrailFeatureStatus {
    Existing,
    Proposed,
}
