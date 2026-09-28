/**
 * Job: Verify Bloomington-Normal map picker defaults are usable and centered.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertTrue

class MapPickerDefaultsSijkoTest {
    @Test
    fun defaultViewportHasUsableBounds() {
        val viewport = MapPickerDefaultsSijko.defaultViewport()

        assertTrue(viewport.northLatitude > viewport.southLatitude)
        assertTrue(viewport.eastLongitude > viewport.westLongitude)
    }

    @Test
    fun defaultPointIsViewportCenter() {
        val viewport = MapPickerDefaultsSijko.defaultViewport()
        val point = MapPickerDefaultsSijko.defaultPoint(viewport)

        assertClose((viewport.northLatitude + viewport.southLatitude) / 2.0, point.latitude)
        assertClose((viewport.westLongitude + viewport.eastLongitude) / 2.0, point.longitude)
    }

    private fun assertClose(expected: Double, actual: Double) {
        assertTrue(abs(expected - actual) < 0.000001, "Expected $actual to be close to $expected")
    }
}
