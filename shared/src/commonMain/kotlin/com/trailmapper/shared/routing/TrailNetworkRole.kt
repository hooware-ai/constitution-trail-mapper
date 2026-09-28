/**
 * Job: Name the route roles assigned to normalized trail-network features.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
enum class TrailNetworkRole {
    TrailBranches,
    ParkConnectors,
    SharedRoadways,
    ProposedTrails,
}
