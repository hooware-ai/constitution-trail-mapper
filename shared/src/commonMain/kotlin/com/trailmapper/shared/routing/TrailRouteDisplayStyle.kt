/**
 * Job: Name the map legend display style for one drawable trail route segment.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
enum class TrailRouteDisplayStyle {
    BloomerLine,
    Collegiate,
    IllinoisCentral,
    Interurban,
    Northtown,
    Route66,
    Route66Advanced,
    Route66Alternate,
    Route66IllinoisCentral,
    Route66Southtown,
    Southtown,
    Proposed,
    ParkTrailConnectors,
    SuggestedSharedRoadways,
    Unknown,
}
