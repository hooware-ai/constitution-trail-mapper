/**
 * Job: Verify exercise-route overlap is tolerated progressively rather than rejected at a small cliff.
 *
 */
package com.trailmapper.shared.routing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExerciseRouteOverlapPenaltySijkoTest {
    @Test
    fun chargesSmallSharedStemsLightlyAndLargeRetracingProgressively() {
        val totalDistanceMeters = 8_000.0
        val smallStemPenalty = ExerciseRouteOverlapPenaltySijko.penaltyMeters(totalDistanceMeters, 400.0)
        val moderateStemPenalty = ExerciseRouteOverlapPenaltySijko.penaltyMeters(totalDistanceMeters, 1_600.0)
        val heavyRetracingPenalty = ExerciseRouteOverlapPenaltySijko.penaltyMeters(totalDistanceMeters, 3_200.0)

        assertEquals(100.0, smallStemPenalty)
        assertTrue(moderateStemPenalty > smallStemPenalty)
        assertTrue(heavyRetracingPenalty - moderateStemPenalty > moderateStemPenalty - smallStemPenalty)
    }

    @Test
    fun handlesEmptyAndInvalidMeasurementsWithoutCreatingAPenalty() {
        assertEquals(0.0, ExerciseRouteOverlapPenaltySijko.penaltyMeters(8_000.0, 0.0))
        assertEquals(0.0, ExerciseRouteOverlapPenaltySijko.penaltyMeters(0.0, 500.0))
        assertEquals(0.0, ExerciseRouteOverlapPenaltySijko.penaltyMeters(Double.NaN, 500.0))
    }
}
