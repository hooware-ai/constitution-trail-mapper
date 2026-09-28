/**
 * Job: Verify endpoint access closure accepts useful roads and rejects mapped detours or token slivers.
 *
 */
package com.trailmapper.shared.routing

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TrailRouteEndpointAccessClosureSijkoTest {
    @Test
    fun acceptsMappedAccessThatMeaningfullyClosesTheGap() {
        assertTrue(
            isMeaningful(
                directDistanceMeters = 181.7,
                mappedDistanceMeters = 124.0,
                estimatedDistanceMeters = 142.7,
            ),
        )
    }

    @Test
    fun rejectsLongMappedDetourThatBarelyClosesTheGap() {
        assertFalse(
            isMeaningful(
                directDistanceMeters = 145.0,
                mappedDistanceMeters = 279.0,
                estimatedDistanceMeters = 143.2,
            ),
        )
    }

    @Test
    fun rejectsTinyMappedSliverBeforeAnEstimatedGap() {
        assertFalse(
            isMeaningful(
                directDistanceMeters = 55.0,
                mappedDistanceMeters = 5.0,
                estimatedDistanceMeters = 30.0,
            ),
        )
    }

    @Test
    fun allowsSmallAlignmentGapWithoutRequiringMappedDistance() {
        assertTrue(
            isMeaningful(
                directDistanceMeters = 5.0,
                mappedDistanceMeters = 0.0,
                estimatedDistanceMeters = 5.0,
            ),
        )
    }

    @Test
    fun rejectsNonFiniteInput() {
        assertFalse(
            isMeaningful(
                directDistanceMeters = Double.NaN,
                mappedDistanceMeters = 100.0,
                estimatedDistanceMeters = 20.0,
            ),
        )
    }

    private fun isMeaningful(
        directDistanceMeters: Double,
        mappedDistanceMeters: Double,
        estimatedDistanceMeters: Double,
    ): Boolean {
        return TrailRouteEndpointAccessClosureSijko.isMeaningful(
            directDistanceMeters = directDistanceMeters,
            mappedDistanceMeters = mappedDistanceMeters,
            estimatedDistanceMeters = estimatedDistanceMeters,
            maxDirectEstimatedMeters = 8.0,
            minimumMappedDistanceMeters = 30.0,
            minimumClosureRatio = 0.2,
        )
    }
}
