/**
 * Job: Maintain reviewed local safety overrides independently from source feature identifiers.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object TrailRoutingHazardCatalogSijko {
    val hazards: List<TrailRoutingHazard> = listOf(
        TrailRoutingHazard(
            id = "oakland-veterans-crossing",
            center = MapPoint(latitude = 40.47390608, longitude = -88.96773407),
            radiusMeters = 55.0,
            fixedPenalty = 50_000.0,
        ),
    )
}
