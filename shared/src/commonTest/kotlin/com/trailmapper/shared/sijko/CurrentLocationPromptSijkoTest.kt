/**
 * Job: Verify the app explains current-location access only when foreground permission is missing.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CurrentLocationPromptSijkoTest {
    @Test
    fun explainsOnlyWhenForegroundLocationPermissionIsMissing() {
        assertTrue(CurrentLocationPromptSijko.shouldExplain(hasForegroundLocationPermission = false))
        assertFalse(CurrentLocationPromptSijko.shouldExplain(hasForegroundLocationPermission = true))
    }
}
