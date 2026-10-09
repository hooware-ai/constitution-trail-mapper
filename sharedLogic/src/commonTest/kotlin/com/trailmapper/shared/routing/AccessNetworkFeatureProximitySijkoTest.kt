/**
 * Job: Verify endpoint-local access data includes nearby and crossing features without leaking distant data.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AccessNetworkFeatureProximitySijkoTest {
    @Test
    fun includesFeatureWithNearbyVertex() {
        val endpoint = MapPoint(latitude = 40.0, longitude = -89.0)
        val feature = feature(
            MapPoint(latitude = 40.0005, longitude = -89.0),
            MapPoint(latitude = 40.001, longitude = -89.0),
        )

        assertTrue(
            AccessNetworkFeatureProximitySijko.isNearAnyPoint(
                feature = feature,
                points = listOf(endpoint),
                maxDistanceMeters = 60.0,
            ),
        )
    }

    @Test
    fun includesLongFeatureThatCrossesBoundedArea() {
        val endpoint = MapPoint(latitude = 40.0, longitude = -89.0)
        val feature = feature(
            MapPoint(latitude = 40.0, longitude = -89.01),
            MapPoint(latitude = 40.0, longitude = -88.99),
        )

        assertTrue(
            AccessNetworkFeatureProximitySijko.isNearAnyPoint(
                feature = feature,
                points = listOf(endpoint),
                maxDistanceMeters = 10.0,
            ),
        )
    }

    @Test
    fun excludesDistantFeature() {
        val feature = feature(
            MapPoint(latitude = 40.02, longitude = -89.0),
            MapPoint(latitude = 40.03, longitude = -89.0),
        )

        assertFalse(
            AccessNetworkFeatureProximitySijko.isNearAnyPoint(
                feature = feature,
                points = listOf(MapPoint(latitude = 40.0, longitude = -89.0)),
                maxDistanceMeters = 1_000.0,
            ),
        )
    }

    @Test
    fun rejectsEmptyPointListAndInvalidDistance() {
        val feature = feature(
            MapPoint(latitude = 40.0, longitude = -89.0),
            MapPoint(latitude = 40.001, longitude = -89.0),
        )

        assertFalse(
            AccessNetworkFeatureProximitySijko.isNearAnyPoint(
                feature = feature,
                points = emptyList(),
                maxDistanceMeters = 1_000.0,
            ),
        )
        assertFalse(
            AccessNetworkFeatureProximitySijko.isNearAnyPoint(
                feature = feature,
                points = listOf(MapPoint(latitude = 40.0, longitude = -89.0)),
                maxDistanceMeters = Double.NaN,
            ),
        )
    }

    private fun feature(
        start: MapPoint,
        destination: MapPoint,
    ): AccessNetworkFeature {
        return AccessNetworkFeature(
            id = "access-feature",
            paths = listOf(listOf(start, destination)),
        )
    }
}
