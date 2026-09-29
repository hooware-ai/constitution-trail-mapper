/**
 * Job: Name the visual role of one drawable route segment.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
enum class TrailRouteSegmentType {
    Trail,
    Access,
}
