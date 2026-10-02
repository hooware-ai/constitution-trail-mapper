/**
 * Job: Verify saved route rows name the kind of ride and its distance in miles.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import kotlin.test.Test
import kotlin.test.assertEquals

class SavedTrailRouteDetailSijkoTest {
    @Test
    fun namesNavigationRoutesAndExerciseLoops() {
        assertEquals("Route · 2.5 mi", SavedTrailRouteDetailSijko.detailFor(route(4_023.0, TrailRouteKind.Navigation)))
        assertEquals("Exercise loop · 6.0 mi", SavedTrailRouteDetailSijko.detailFor(route(9_656.0, TrailRouteKind.ExerciseLoop)))
    }

    @Test
    fun roundsMilesToOneDecimalPlace() {
        assertEquals("0.0", TrailMilesTextSijko.milesText(0.0))
        assertEquals("0.1", TrailMilesTextSijko.milesText(161.0))
        assertEquals("1.0", TrailMilesTextSijko.milesText(1_609.344))
        assertEquals("12.4", TrailMilesTextSijko.milesText(20_000.0))
    }

    private fun route(
        meters: Double,
        kind: TrailRouteKind,
    ): TrailRoute {
        return TrailRoute(
            totalDistanceMeters = meters,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = meters,
            kind = kind,
        )
    }
}
