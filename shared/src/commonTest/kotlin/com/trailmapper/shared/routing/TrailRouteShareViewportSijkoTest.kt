/**
 * Job: Verify shared route images receive padded, valid bounds for normal and degenerate geometry.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class TrailRouteShareViewportSijkoTest {
    @Test
    fun padsBoundsAroundMultiplePoints() {
        val viewport = TrailRouteShareViewportSijko.viewportFor(
            listOf(
                MapPoint(latitude = 40.0, longitude = -89.0),
                MapPoint(latitude = 41.0, longitude = -88.0),
            ),
        )

        requireNotNull(viewport)
        assertEquals(39.92, viewport.southLatitude, ABSOLUTE_TOLERANCE)
        assertEquals(-89.08, viewport.westLongitude, ABSOLUTE_TOLERANCE)
        assertEquals(41.08, viewport.northLatitude, ABSOLUTE_TOLERANCE)
        assertEquals(-87.92, viewport.eastLongitude, ABSOLUTE_TOLERANCE)
    }

    @Test
    fun createsVisibleBoundsAroundOnePoint() {
        val viewport = TrailRouteShareViewportSijko.viewportFor(
            listOf(MapPoint(latitude = 40.5, longitude = -88.95)),
        )

        requireNotNull(viewport)
        assertEquals(40.49884, viewport.southLatitude, ABSOLUTE_TOLERANCE)
        assertEquals(-88.95116, viewport.westLongitude, ABSOLUTE_TOLERANCE)
        assertEquals(40.50116, viewport.northLatitude, ABSOLUTE_TOLERANCE)
        assertEquals(-88.94884, viewport.eastLongitude, ABSOLUTE_TOLERANCE)
    }

    @Test
    fun ignoresInvalidPoints() {
        val viewport = TrailRouteShareViewportSijko.viewportFor(
            listOf(
                MapPoint(latitude = Double.NaN, longitude = -88.95),
                MapPoint(latitude = 40.5, longitude = -88.95),
            ),
        )

        requireNotNull(viewport)
        assertEquals(40.5, (viewport.southLatitude + viewport.northLatitude) / 2.0)
    }

    @Test
    fun returnsNullWithoutValidPoints() {
        assertNull(
            TrailRouteShareViewportSijko.viewportFor(
                listOf(MapPoint(latitude = 95.0, longitude = -88.95)),
            ),
        )
    }

    private companion object {
        const val ABSOLUTE_TOLERANCE = 0.0000001
    }
}
