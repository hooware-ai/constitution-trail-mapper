/**
 * Job: Verify route names are normalized and compared without formatting-only direction changes.
 *
 */
package com.trailmapper.shared.routing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrailRouteNameSijkoTest {
    @Test
    fun normalizationTrimsNamesAndRejectsBlankValues() {
        assertEquals("Oak Street", TrailRouteNameSijko.normalized("  Oak Street  "))
        assertNull(TrailRouteNameSijko.normalized("   "))
        assertNull(TrailRouteNameSijko.normalized(null))
    }

    @Test
    fun comparisonIgnoresCaseAndSurroundingWhitespace() {
        assertTrue(TrailRouteNameSijko.matches("  Constitution Trail", "constitution trail  "))
        assertTrue(TrailRouteNameSijko.matches(null, " "))
        assertFalse(TrailRouteNameSijko.matches("Oak Street", "Main Street"))
    }
}
