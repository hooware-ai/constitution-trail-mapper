/**
 * Job: Verify tiny unnamed connectors defer their cue to the next real named leg.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TrailRouteInstructionTransientLegSijkoTest {
    @Test
    fun tinyUnnamedConnectorBeforeNamedLegDefersTransition() {
        assertTrue(
            TrailRouteInstructionTransientLegSijko.shouldDeferTransition(
                current = leg(distanceMeters = 8.0),
                next = leg(distanceMeters = 100.0, name = "E University Ave"),
            ),
        )
    }

    @Test
    fun namedLongOrTypeChangingLegDoesNotDeferTransition() {
        assertFalse(
            TrailRouteInstructionTransientLegSijko.shouldDeferTransition(
                current = leg(distanceMeters = 8.0, name = "Driveway"),
                next = leg(distanceMeters = 100.0, name = "E University Ave"),
            ),
        )
        assertFalse(
            TrailRouteInstructionTransientLegSijko.shouldDeferTransition(
                current = leg(distanceMeters = 30.0),
                next = leg(distanceMeters = 100.0, name = "E University Ave"),
            ),
        )
        assertFalse(
            TrailRouteInstructionTransientLegSijko.shouldDeferTransition(
                current = leg(distanceMeters = 8.0),
                next = leg(
                    distanceMeters = 100.0,
                    name = "Constitution Trail",
                    segmentType = TrailRouteSegmentType.Trail,
                ),
            ),
        )
    }

    private fun leg(
        distanceMeters: Double,
        name: String? = null,
        segmentType: TrailRouteSegmentType = TrailRouteSegmentType.Access,
    ): TrailRouteInstructionLeg {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val end = MapPoint(latitude = 40.001, longitude = -89.0)
        return TrailRouteInstructionLeg(
            start = start,
            end = end,
            distanceMeters = distanceMeters,
            entryBearingDegrees = 0.0,
            exitBearingDegrees = 0.0,
            segmentType = segmentType,
            routeRoles = emptySet(),
            displayStyle = TrailRouteDisplayStyle.Unknown,
            name = name,
        )
    }
}
