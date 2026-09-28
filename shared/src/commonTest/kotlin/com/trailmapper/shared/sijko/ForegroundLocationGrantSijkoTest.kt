/**
 * Job: Verify foreground location access is granted when either fine or coarse permission is granted.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ForegroundLocationGrantSijkoTest {
    @Test
    fun acceptsEitherFineOrCoarseLocationGrant() {
        assertTrue(ForegroundLocationGrantSijko.isGranted(fineGranted = true, coarseGranted = false))
        assertTrue(ForegroundLocationGrantSijko.isGranted(fineGranted = false, coarseGranted = true))
        assertTrue(ForegroundLocationGrantSijko.isGranted(fineGranted = true, coarseGranted = true))
    }

    @Test
    fun rejectsWhenBothLocationPermissionsAreMissing() {
        assertFalse(ForegroundLocationGrantSijko.isGranted(fineGranted = false, coarseGranted = false))
    }
}
