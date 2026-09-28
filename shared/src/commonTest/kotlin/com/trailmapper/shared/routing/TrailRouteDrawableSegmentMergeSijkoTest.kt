/**
 * Job: Verify drawable route segments are coalesced without hiding meaningful route style changes.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals

class TrailRouteDrawableSegmentMergeSijkoTest {
    @Test
    fun mergesAdjacentTrailSegmentsWithExactSharedPoint() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val last = MapPoint(latitude = 40.001, longitude = -88.999)

        val merged = TrailRouteDrawableSegmentMergeSijko.merge(
            listOf(
                segment(first, middle),
                segment(middle, last),
            ),
        )

        assertEquals(1, merged.size)
        assertEquals(listOf(first, middle, last), merged.first().points)
    }

    @Test
    fun mergesAdjacentTrailSegmentsWithTinyCoordinateGap() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val nearbyMiddle = MapPoint(latitude = 40.00002, longitude = -88.999)
        val last = MapPoint(latitude = 40.001, longitude = -88.999)

        val merged = TrailRouteDrawableSegmentMergeSijko.merge(
            listOf(
                segment(first, middle),
                segment(nearbyMiddle, last),
            ),
        )

        assertEquals(1, merged.size)
        assertEquals(listOf(first, middle, nearbyMiddle, last), merged.first().points)
    }

    @Test
    fun keepsDifferentAccessCertaintySeparate() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val last = MapPoint(latitude = 40.001, longitude = -88.999)

        val merged = TrailRouteDrawableSegmentMergeSijko.merge(
            listOf(
                segment(
                    first = first,
                    last = middle,
                    type = TrailRouteSegmentType.Access,
                    isRouted = true,
                ),
                segment(
                    first = middle,
                    last = last,
                    type = TrailRouteSegmentType.Access,
                    isRouted = false,
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

        val merged = TrailRouteDrawableSegmentMergeSijko.merge(
            listOf(
                segment(
                    first = first,
                    last = middle,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                ),
                segment(
                    first = middle,
                    last = last,
                    routeRoles = setOf(TrailNetworkRole.ParkConnectors),
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

        val merged = TrailRouteDrawableSegmentMergeSijko.merge(
            listOf(
                segment(
                    first = first,
                    last = middle,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    displayStyle = TrailRouteDisplayStyle.Route66,
                ),
                segment(
                    first = middle,
                    last = last,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    displayStyle = TrailRouteDisplayStyle.Southtown,
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

        val merged = TrailRouteDrawableSegmentMergeSijko.merge(
            listOf(
                segment(first = first, last = middle, name = "First Trail"),
                segment(first = middle, last = last, name = "Second Trail"),
            ),
        )

        assertEquals(2, merged.size)
    }

    @Test
    fun keepsLargeGapsSeparate() {
        val first = MapPoint(latitude = 40.0, longitude = -89.0)
        val middle = MapPoint(latitude = 40.0, longitude = -88.999)
        val farMiddle = MapPoint(latitude = 40.01, longitude = -88.999)
        val last = MapPoint(latitude = 40.011, longitude = -88.999)

        val merged = TrailRouteDrawableSegmentMergeSijko.merge(
            listOf(
                segment(first, middle),
                segment(farMiddle, last),
            ),
        )

        assertEquals(2, merged.size)
    }

    private fun segment(
        first: MapPoint,
        last: MapPoint,
        type: TrailRouteSegmentType = TrailRouteSegmentType.Trail,
        isRouted: Boolean = true,
        routeRoles: Set<TrailNetworkRole> = emptySet(),
        displayStyle: TrailRouteDisplayStyle = TrailRouteDisplayStyle.Unknown,
        name: String? = null,
    ): TrailRouteSegment {
        return TrailRouteSegment(
            type = type,
            points = listOf(first, last),
            isRouted = isRouted,
            routeRoles = routeRoles,
            displayStyle = displayStyle,
            name = name,
        )
    }
}
