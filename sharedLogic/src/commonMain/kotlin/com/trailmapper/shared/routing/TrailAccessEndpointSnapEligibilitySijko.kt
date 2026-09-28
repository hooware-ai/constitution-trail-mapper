/**
 * Job: Decide which ordinary-access graph edges may receive off-network endpoint snaps.
 *
 */
package com.trailmapper.shared.routing

object TrailAccessEndpointSnapEligibilitySijko {
    fun isEligible(
        edge: TrailGraphEdge,
        snapDistanceMeters: Double,
        directPathSnapMeters: Double = 8.0,
    ): Boolean {
        val roadClass = edge.accessRoadClass ?: return true
        return roadClass !in PathOnlyRoadClasses || snapDistanceMeters <= directPathSnapMeters
    }

    private val PathOnlyRoadClasses = setOf(
        "S1710",
        "S1820",
    )
}
