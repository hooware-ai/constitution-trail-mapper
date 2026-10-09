/**
 * Job: Verify exercise access-road filtering keeps reachable streets and removes distant graph work.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals

class ExerciseRouteAccessNetworkFilterSijkoTest {
    @Test
    fun keepsOnlyFeaturesInsideTheLoopReach() {
        val start = MapPoint(latitude = 40.467, longitude = -88.934)
        val nearby = feature("nearby", start, MapPoint(latitude = 40.468, longitude = -88.934))
        val distant = feature(
            "distant",
            MapPoint(latitude = 40.60, longitude = -88.70),
            MapPoint(latitude = 40.61, longitude = -88.70),
        )

        assertEquals(
            listOf(nearby),
            ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(
                features = listOf(nearby, distant),
                startPoint = start,
                targetDistanceMeters = 8_046.72,
            ),
        )
    }

    private fun feature(
        id: String,
        first: MapPoint,
        second: MapPoint,
    ): AccessNetworkFeature {
        return AccessNetworkFeature(
            id = id,
            paths = listOf(listOf(first, second)),
        )
    }
}
