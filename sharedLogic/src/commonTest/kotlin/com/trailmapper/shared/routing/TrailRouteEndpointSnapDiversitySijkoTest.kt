/**
 * Job: Verify endpoint snap candidate searches preserve nearby alternate features.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailRouteEndpointSnapDiversitySijkoTest {
    @Test
    fun keepsAlternateFeatureWhenNearestFeatureHasManySegments() {
        val mainSnaps = (0 until 10).map { index ->
            snap(
                edgeId = index,
                sourceFeatureId = "main-trail",
                accessDistanceMeters = index.toDouble(),
            )
        }
        val connectorSnap = snap(
            edgeId = 99,
            sourceFeatureId = "connector",
            accessDistanceMeters = 10.0,
        )

        val selected = TrailRouteEndpointSnapDiversitySijko.select(
            snaps = mainSnaps + connectorSnap,
            limit = 5,
        )

        assertTrue(selected.any { it.edge.sourceFeatureId == "connector" })
        assertEquals(
            4,
            selected.count { it.edge.sourceFeatureId == "main-trail" },
        )
    }

    @Test
    fun duplicateEdgesAtSameFeatureLocationDoNotConsumeDiversitySlots() {
        val duplicatePoint = MapPoint(latitude = 40.0, longitude = -89.0)
        val duplicateSnaps = (0 until 4).map { index ->
            snap(
                edgeId = index,
                sourceFeatureId = "shared-road",
                accessDistanceMeters = index.toDouble(),
                projectedPoint = duplicatePoint,
            )
        }
        val distinctSnap = snap(
            edgeId = 10,
            sourceFeatureId = "shared-road",
            accessDistanceMeters = 4.0,
            projectedPoint = MapPoint(latitude = 40.001, longitude = -89.0),
        )

        val selected = TrailRouteEndpointSnapDiversitySijko.select(
            snaps = duplicateSnaps + distinctSnap,
            limit = 4,
        )

        assertEquals(2, selected.size)
        assertTrue(selected.any { it.projectedPoint == distinctSnap.projectedPoint })
    }

    private fun snap(
        edgeId: Int,
        sourceFeatureId: String,
        accessDistanceMeters: Double,
        projectedPoint: MapPoint = MapPoint(
            latitude = 40.0,
            longitude = -89.0 + edgeId * 0.0001,
        ),
    ): TrailNetworkSnap {
        return TrailNetworkSnap(
            edge = TrailGraphEdge(
                id = edgeId,
                fromNodeId = edgeId,
                toNodeId = edgeId + 1,
                distanceMeters = 1.0,
                sourceFeatureId = sourceFeatureId,
            ),
            projectedPoint = projectedPoint,
            accessDistanceMeters = accessDistanceMeters,
            distanceFromStartMeters = 0.0,
            distanceToEndMeters = 1.0,
        )
    }
}
