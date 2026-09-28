/**
 * Job: Name the comfort levels used when weighting trail-network route edges.
 *
 */
package com.trailmapper.shared.routing

import kotlinx.serialization.Serializable

@Serializable
enum class TrailComfortLevel {
    AllAgesAndAbilities,
    MostAdults,
    ExperiencedBicyclists,
    StrongAndFearless,
    Unknown,
}
