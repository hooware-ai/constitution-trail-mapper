/**
 * Job: Verify drawable route segment normalization before map rendering.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals

class TrailRouteSegmentMergeSijkoTest {
    @Test
    fun mergesAdjacentSegmentsWithSameType() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val last = MapPoint(latitude = 40.001, longitude = -88.999)

        val merged = TrailRouteSegmentMergeSijko.merge(
            listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(first, middle),
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(middle, last),
                ),
            ),
        )

        assertEquals(
            listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(first, middle, last),
                ),
            ),
            merged,
        )
    }

    @Test
    fun dropsZeroLengthSegments() {
        val point = MapPoint(latitude = 40.0, longitude = -89.0)

        val merged = TrailRouteSegmentMergeSijko.merge(
            listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(point, point),
                ),
            ),
        )

        assertEquals(emptyList(), merged)
    }

    @Test
    fun keepsRoutedAndEstimatedSegmentsSeparate() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val last = MapPoint(latitude = 40.001, longitude = -88.999)

        val merged = TrailRouteSegmentMergeSijko.merge(
            listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(first, middle),
                    isRouted = false,
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(middle, last),
                    isRouted = true,
                ),
            ),
        )

        assertEquals(2, merged.size)
    }

    @Test
    fun keepsDifferentRouteRolesSeparate() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val last = MapPoint(latitude = 40.001, longitude = -88.999)

        val merged = TrailRouteSegmentMergeSijko.merge(
            listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(first, middle),
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(middle, last),
                    routeRoles = setOf(TrailNetworkRole.SharedRoadways),
                ),
            ),
        )

        assertEquals(2, merged.size)
    }

    @Test
    fun keepsDifferentDisplayStylesSeparate() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val last = MapPoint(latitude = 40.001, longitude = -88.999)

        val merged = TrailRouteSegmentMergeSijko.merge(
            listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(first, middle),
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    displayStyle = TrailRouteDisplayStyle.BloomerLine,
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(middle, last),
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    displayStyle = TrailRouteDisplayStyle.Interurban,
                ),
            ),
        )

        assertEquals(2, merged.size)
    }

    @Test
    fun keepsDifferentlyNamedSegmentsSeparate() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val last = MapPoint(latitude = 40.001, longitude = -88.999)

        val merged = TrailRouteSegmentMergeSijko.merge(
            listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(first, middle),
                    name = "First Trail",
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(middle, last),
                    name = "Second Trail",
                ),
            ),
        )

        assertEquals(2, merged.size)
    }

    @Test
    fun normalizesBlankNamesBeforeMerging() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val last = MapPoint(latitude = 40.001, longitude = -88.999)

        val merged = TrailRouteSegmentMergeSijko.merge(
            listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(first, middle),
                    name = " ",
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(middle, last),
                ),
            ),
        )

        assertEquals(1, merged.size)
        assertEquals(null, merged.single().name)
    }
}
