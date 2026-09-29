/**
 * Job: Verify shared route calculation applies route-layer filtering and optional access routing.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.coroutines.cancellation.CancellationException
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrailRouteCalculationSijkoTest {
    @Test
    fun keepsProposedTrailsOptIn() {
        val proposedFeature = feature(
            id = "future",
            status = TrailFeatureStatus.Proposed,
            roles = setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.ProposedTrails),
            path = listOf(
                MapPoint(latitude = 40.0, longitude = -89.0),
                MapPoint(latitude = 40.0, longitude = -88.999),
            ),
        )

        assertNull(
            TrailRouteCalculationSijko.findRoute(
                features = listOf(proposedFeature),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = MapPoint(latitude = 40.0, longitude = -89.0),
                destinationPoint = MapPoint(latitude = 40.0, longitude = -88.999),
                accessGraph = null,
            ),
        )
        assertNotNull(
            TrailRouteCalculationSijko.findRoute(
                features = listOf(proposedFeature),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = true),
                startPoint = MapPoint(latitude = 40.0, longitude = -89.0),
                destinationPoint = MapPoint(latitude = 40.0, longitude = -88.999),
                accessGraph = null,
            ),
        )
    }

    @Test
    fun usesAccessGraphWhenProvided() {
        val start = MapPoint(latitude = 40.0, longitude = -89.003)
        val trailEntry = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.0, longitude = -88.999)
        val route = assertNotNull(
            TrailRouteCalculationSijko.findRoute(
                features = listOf(
                    feature(
                        id = "trail",
                        status = TrailFeatureStatus.Existing,
                        roles = setOf(TrailNetworkRole.TrailBranches),
                        path = listOf(trailEntry, destination),
                    ),
                ),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = start,
                destinationPoint = destination,
                accessGraph = AccessGraphBuilderSijko.buildGraph(
                    features = listOf(
                        AccessNetworkFeature(
                            id = "ordinary-access",
                            paths = listOf(listOf(start, trailEntry)),
                        ),
                    ),
                ),
            ),
        )

        assertTrue(route.ordinaryAccessDistanceMeters > 200.0)
        assertTrue(route.segments.any { it.type == TrailRouteSegmentType.Access && it.isRouted })
    }

    @Test
    fun propagatesCancellationCheckpoint() {
        assertFailsWith<CancellationException> {
            TrailRouteCalculationSijko.findRoute(
                features = listOf(
                    feature(
                        id = "trail",
                        status = TrailFeatureStatus.Existing,
                        roles = setOf(TrailNetworkRole.TrailBranches),
                        path = listOf(
                            MapPoint(latitude = 40.0, longitude = -89.0),
                            MapPoint(latitude = 40.0, longitude = -88.999),
                        ),
                    ),
                ),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = MapPoint(latitude = 40.0, longitude = -89.0),
                destinationPoint = MapPoint(latitude = 40.0, longitude = -88.999),
                accessGraph = null,
                cancellationCheckpoint = { throw CancellationException("cancel route calculation") },
            )
        }
    }

    @Test
    fun turningAtARealJunctionToStayOnTheSameTrailGetsAnInstruction() {
        // Main trail runs north to a junction and turns west; a side trail carries straight on north.
        val route = assertNotNull(
            TrailRouteCalculationSijko.findRoute(
                features = listOf(mainTrail, namedTrail("side", "Side trail", junction, MapPoint(40.01, -89.0))),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = mainStart,
                destinationPoint = mainEnd,
                accessGraph = null,
            ),
        )

        val texts = TrailRouteTurnInstructionSijko.instructionsFor(route).map { it.text }
        assertTrue(texts.any { it.startsWith("Turn left") && it.endsWith("to stay on Main trail") }, "$texts")

        // A route saved before choice points were recorded keeps its previous guidance.
        val saved = route.copy(traversalEdges = emptyList())
        assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(saved).none { "to stay on" in it.text })
    }

    @Test
    fun aBendWithNoJunctionGetsNoInstruction() {
        val route = assertNotNull(
            TrailRouteCalculationSijko.findRoute(
                features = listOf(mainTrail),
                routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
                startPoint = mainStart,
                destinationPoint = mainEnd,
                accessGraph = null,
            ),
        )

        assertTrue(TrailRouteTurnInstructionSijko.instructionsFor(route).none { "to stay on" in it.text })
    }

    private val mainStart = MapPoint(40.0, -89.0)
    private val junction = MapPoint(40.005, -89.0)
    private val mainEnd = MapPoint(40.005, -89.006)
    private val mainTrail get() = namedTrail("main", "Main trail", mainStart, junction, mainEnd)

    private fun namedTrail(id: String, name: String, vararg points: MapPoint) = TrailNetworkFeature(
        id = id,
        name = name,
        status = TrailFeatureStatus.Existing,
        routeRoles = setOf(TrailNetworkRole.TrailBranches),
        facilityType = TrailFacilityType.UrbanTrail,
        comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        paths = listOf(points.toList()),
    )

    private fun feature(
        id: String,
        status: TrailFeatureStatus,
        roles: Set<TrailNetworkRole>,
        path: List<MapPoint>,
    ): TrailNetworkFeature {
        return TrailNetworkFeature(
            id = id,
            status = status,
            routeRoles = roles,
            facilityType = TrailFacilityType.UrbanTrail,
            comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
            paths = listOf(path),
        )
    }
}
