/**
 * Job: Verify user points snap to the nearest approved trail segment.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.PI
import kotlin.math.cos
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class NearestTrailSnapSijkoTest {
    @Test
    fun snapsToNearestEdgeProjection() {
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                TrailNetworkFeature(
                    id = "trail",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(
                        listOf(
                            MapPoint(latitude = 40.0, longitude = -89.0),
                            MapPoint(latitude = 40.0, longitude = -88.999),
                        ),
                    ),
                ),
            ),
        )

        val snap = assertNotNull(
            NearestTrailSnapSijko.nearestSnap(
                graph = graph,
                point = MapPoint(latitude = 40.0001, longitude = -88.9995),
            ),
        )

        assertTrue(snap.accessDistanceMeters in 10.0..13.0)
        assertTrue(snap.distanceFromStartMeters > 0.0)
        assertTrue(snap.distanceToEndMeters > 0.0)
    }

    @Test
    fun callsCancellationCheckpointDuringScan() {
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                TrailNetworkFeature(
                    id = "trail",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(
                        listOf(
                            MapPoint(latitude = 40.0, longitude = -89.0),
                            MapPoint(latitude = 40.0, longitude = -88.999),
                        ),
                    ),
                ),
            ),
        )
        var checkpoints = 0

        NearestTrailSnapSijko.nearestSnap(
            graph = graph,
            point = MapPoint(latitude = 40.0001, longitude = -88.9995),
            cancellationCheckpoint = { checkpoints += 1 },
        )

        assertTrue(checkpoints > 0)
    }

    @Test
    fun canIncludeTrailNodesAsCandidateSnaps() {
        val trailStart = MapPoint(latitude = 40.0, longitude = -89.0)
        val trailEnd = MapPoint(latitude = 40.0, longitude = -88.996)
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                TrailNetworkFeature(
                    id = "trail",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(listOf(trailStart, trailEnd)),
                ),
            ),
        )

        val snaps = NearestTrailSnapSijko.nearestSnaps(
            graph = graph,
            point = MapPoint(latitude = 40.0001, longitude = -88.998),
            limit = 5,
            includeNodeSnaps = true,
        )

        assertTrue(snaps.any { it.projectedPoint == trailStart })
        assertTrue(snaps.any { it.projectedPoint == trailEnd })
        assertEquals(0.0, snaps.first { it.projectedPoint == trailStart }.distanceFromStartMeters)
    }

    @Test
    fun aNodeSnapMeasuresTheLineItsGeometryFollows() {
        // The trail's first vertex snaps onto the node already 10 m west of it, so from its far end the
        // snap's geometry runs 110 m to that node, while the edge's own vertices are 100 m apart.
        val node = offset(-10.0, 0.0)
        val far = offset(100.0, 0.0)
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                TrailNetworkFeature(
                    id = "first",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(listOf(offset(-10.0, -80.0), node)),
                ),
                TrailNetworkFeature(
                    id = "trail",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(listOf(offset(0.0, 0.0), far)),
                ),
            ),
        )
        val trail = graph.edges.single { it.sourceFeatureId == "trail" }
        assertEquals(100.0, trail.distanceMeters, 0.1)

        // The node snap and the projection onto the edge's end both land on the far node; they must agree.
        val atFar = NearestTrailSnapSijko.nearestSnaps(
            graph = graph,
            point = offset(100.0, 5.0),
            limit = 10,
            includeNodeSnaps = true,
        ).filter { it.projectedPoint == far && it.edge.id == trail.id }

        assertEquals(2, atFar.size)
        atFar.forEach { snap ->
            assertEquals(110.0, snap.distanceFromStartMeters, 0.1)
            assertEquals(
                snap.distanceFromStartMeters,
                TrailDistanceSijko.pathLengthMeters(snap.trailPointsToward(node, towardEdgeEnd = false)),
                1e-6,
            )
        }
    }

    @Test
    fun snapsOntoTheBendOfAFoldedPolylineEdge() {
        // B is within the 15 m snap tolerance of A, so A-B-C folds into one bent edge.
        val a = offset(0.0, 0.0)
        val b = offset(14.0, 0.0)
        val c = offset(14.0, 14.0)
        val graph = TrailGraphBuilderSijko.buildGraph(
            features = listOf(
                TrailNetworkFeature(
                    id = "bent",
                    status = TrailFeatureStatus.Existing,
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = listOf(listOf(a, b, c)),
                ),
            ),
        )
        assertEquals(listOf(a, b, c), graph.edges.single().routeSegments.single().points)

        val atBend = assertNotNull(NearestTrailSnapSijko.nearestSnap(graph = graph, point = b))
        assertEquals(0.0, atBend.accessDistanceMeters, 0.01)
        assertEquals(14.0, atBend.distanceFromStartMeters, 0.05)
        assertEquals(14.0, atBend.distanceToEndMeters, 0.05)

        val onFirstLeg = assertNotNull(NearestTrailSnapSijko.nearestSnap(graph = graph, point = offset(7.0, 1.0)))
        assertEquals(1.0, onFirstLeg.accessDistanceMeters, 0.01)
        assertEquals(7.0, onFirstLeg.distanceFromStartMeters, 0.05)
        assertEquals(listOf(onFirstLeg.projectedPoint, b, c), onFirstLeg.trailPointsToward(c, towardEdgeEnd = true))
        assertEquals(listOf(onFirstLeg.projectedPoint, a), onFirstLeg.trailPointsToward(a, towardEdgeEnd = false))
    }

    /** A point [eastMeters] east and [northMeters] north of (40, -89). */
    private fun offset(eastMeters: Double, northMeters: Double): MapPoint {
        val metersPerDegree = 6_371_008.8 * PI / 180.0
        return MapPoint(
            latitude = 40.0 + northMeters / metersPerDegree,
            longitude = -89.0 + eastMeters / (metersPerDegree * cos(40.0 * PI / 180.0)),
        )
    }
}
