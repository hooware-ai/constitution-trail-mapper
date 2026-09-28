/**
 * Job: Verify shared-image cues offset second passes to the right of travel and face chevrons along it.
 *
 */
package com.trailmapper.android.routing

import kotlin.test.Test
import kotlin.test.assertEquals

class TrailRouteShareCueGeometryTest {
    @Test
    fun offsetsToTheRightOfTravelInImageCoordinates() {
        // Travelling up the image (north), the right-hand side is +x (east).
        val north = TrailRouteShareCueGeometry.offsetToTheRight(listOf(SharePixel(0f, 100f), SharePixel(0f, 0f)), 20f)
        assertEquals(listOf(SharePixel(20f, 100f), SharePixel(20f, 0f)), north)

        // Travelling east, the right-hand side is +y (down the image, south).
        val east = TrailRouteShareCueGeometry.offsetToTheRight(listOf(SharePixel(0f, 0f), SharePixel(100f, 0f)), 20f)
        assertEquals(listOf(SharePixel(0f, 20f), SharePixel(100f, 20f)), east)
    }

    @Test
    fun placesChevronsAtEvenSpacingFacingTravel() {
        val path = listOf(SharePixel(0f, 0f), SharePixel(100f, 0f), SharePixel(100f, 100f))

        val chevrons = TrailRouteShareCueGeometry.chevronsAlong(path, spacingPixels = 50f)

        assertEquals(
            listOf(
                ShareChevron(25f, 0f, 0f),
                ShareChevron(75f, 0f, 0f),
                ShareChevron(100f, 25f, 90f),
                ShareChevron(100f, 75f, 90f),
            ),
            chevrons,
        )
    }

    @Test
    fun aPathShorterThanHalfASpacingHasNoChevrons() {
        val chevrons = TrailRouteShareCueGeometry.chevronsAlong(listOf(SharePixel(0f, 0f), SharePixel(10f, 0f)), 50f)

        assertEquals(emptyList(), chevrons)
    }
}
