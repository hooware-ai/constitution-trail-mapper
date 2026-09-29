/**
 * Job: Verify endpoint candidate selection retains mapped access that efficiently approaches the approved network.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertTrue

class TrailRouteEndpointAccessSelectorSijkoTest {
    @Test
    fun retainsUsefulMappedAccessWhenItIsShorterThanTheEstimatedEndpointGap() {
        val endpoint = MapPoint(latitude = 40.0, longitude = -89.0)
        val roadStart = MapPoint(latitude = 39.998716, longitude = -89.0)
        val handoff = MapPoint(latitude = 39.998716, longitude = -88.99867)
        val trailContinuation = MapPoint(latitude = 39.9975, longitude = -88.99867)
        val trailGraph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                TrailNetworkFeature(
                    id = "natural-handoff",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.SharedRoadways),
                    facilityType = TrailFacilityType.SharedLane,
                    comfortLevel = TrailComfortLevel.MostAdults,
                    paths = listOf(listOf(handoff, trailContinuation)),
                ),
            ),
        )
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "approach-road",
                    paths = listOf(listOf(roadStart, handoff)),
                ),
            ),
        )

        val candidates = TrailRouteEndpointAccessSelectorSijko.candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = endpoint,
            allowExtendedAccessFallback = false,
        )

        val handoffCandidate = candidates.first { candidate ->
            candidate.snap.edge.sourceFeatureId == "natural-handoff"
        }
        val mappedMeters = handoffCandidate.accessSegments
            .filter { it.isRouted }
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
        val estimatedMeters = handoffCandidate.accessSegments
            .filter { !it.isRouted }
            .sumOf { TrailDistanceSijko.pathLengthMeters(it.points) }
        assertTrue(mappedMeters < estimatedMeters)
    }

    @Test
    fun retainsMoreThanFourUsefulRoughLocationsFromOneFeature() {
        val endpoint = MapPoint(latitude = 40.0, longitude = -89.0)
        val targetPoints = horizontalPoints(latitude = 40.001)
        val decoyPoints = horizontalPoints(latitude = 40.005)
        val trailGraph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                sharedRoadFeature(id = "target", points = targetPoints),
                sharedRoadFeature(id = "decoy", points = decoyPoints),
            ),
        )
        val accessGraph = AccessGraphBuilderSijko.buildGraph(
            features = listOf(
                AccessNetworkFeature(
                    id = "target-access",
                    paths = listOf(listOf(endpoint, targetPoints[targetPoints.size / 2]) + targetPoints),
                ),
                AccessNetworkFeature(
                    id = "decoy-access",
                    paths = listOf(listOf(endpoint, decoyPoints[decoyPoints.size / 2]) + decoyPoints),
                ),
            ),
        )

        val candidates = TrailRouteEndpointAccessSelectorSijko.candidates(
            trailGraph = trailGraph,
            accessGraph = accessGraph,
            endpointPoint = endpoint,
            roughCandidateLimit = 8,
            resultLimit = 8,
            allowExtendedAccessFallback = false,
        )

        assertTrue(
            candidates.count { candidate -> candidate.snap.edge.sourceFeatureId == "target" } > 4,
            "Expected broad rough coverage for the target feature, but got $candidates",
        )
    }

    private fun horizontalPoints(latitude: Double): List<MapPoint> {
        return (0..8).map { index ->
            MapPoint(
                latitude = latitude,
                longitude = -89.004 + index * 0.001,
            )
        }
    }

    private fun sharedRoadFeature(
        id: String,
        points: List<MapPoint>,
    ): TrailNetworkFeature {
        return TrailNetworkFeature(
            id = id,
            status = TrailFeatureStatus.Existing,
            routeRoles = setOf(TrailNetworkRole.SharedRoadways),
            facilityType = TrailFacilityType.SharedLane,
            comfortLevel = TrailComfortLevel.MostAdults,
            paths = listOf(points),
        )
    }
}
