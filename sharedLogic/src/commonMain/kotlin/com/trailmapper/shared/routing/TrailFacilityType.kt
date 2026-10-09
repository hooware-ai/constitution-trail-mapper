/**
 * Job: Name the facility types used when weighting trail-network route edges.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
enum class TrailFacilityType {
    BikeLane,
    OffRoadTrail,
    SeparatedTrail,
    SharedLane,
    UrbanTrail,
    Other,
    Unknown,
}
