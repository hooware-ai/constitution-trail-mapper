/**
 * Job: Verify useful exercise circuits reject substantial retracing while allowing a short shared stem.
 *
 */
package com.trailmapper.shared.routing

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ExerciseRouteLoopQualitySijkoTest {
    @Test
    fun acceptsUsefulSharedStemsButRejectsMostlyOutAndBackRoutes() {
        assertTrue(
            ExerciseRouteLoopQualitySijko.isCircuit(
                totalDistanceMeters = 8_046.72,
                selfOverlapMeters = 2_000.0,
            ),
        )
        assertFalse(
            ExerciseRouteLoopQualitySijko.isCircuit(
                totalDistanceMeters = 8_046.72,
                selfOverlapMeters = 3_500.0,
            ),
        )
        assertTrue(ExerciseRouteLoopQualitySijko.maximumSelfOverlapMeters(8_046.72) > 3_000.0)
    }

    @Test
    fun rejectsInvalidMeasurements() {
        assertFalse(ExerciseRouteLoopQualitySijko.isCircuit(0.0, 0.0))
        assertFalse(ExerciseRouteLoopQualitySijko.isCircuit(Double.NaN, 0.0))
        assertFalse(ExerciseRouteLoopQualitySijko.isCircuit(1_000.0, Double.NaN))
    }
}
