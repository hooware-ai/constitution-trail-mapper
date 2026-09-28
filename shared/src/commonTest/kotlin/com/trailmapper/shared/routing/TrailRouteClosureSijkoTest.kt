/**
 * Job: Verify active trail closures are cut from new route searches without touching nearby trail.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrailRouteClosureSijkoTest {
    @Test
    fun cutsTheClosedSectionAndKeepsItsBoundingVerticesAsOpenEnds() {
        val network = TrailRouteClosureSijko.openFeatures(listOf(uptownTrail), September27)

        val paths = network.features.single().paths
        assertEquals(listOf(listOf(south, closedFrom), listOf(closedTo, north)), paths)
        assertEquals(listOf(closure), network.appliedClosures)
    }

    @Test
    fun leavesTrailUnchangedBeforeTheClosureStarts() {
        val network = TrailRouteClosureSijko.openFeatures(listOf(uptownTrail), September20)

        assertEquals(listOf(uptownTrail), network.features)
        assertTrue(network.appliedClosures.isEmpty())
    }

    @Test
    fun leavesCrossingAndNeighboringFeaturesAlone() {
        val collegiate = feature("54:68", MapPoint(40.507508, -88.984580), closedFrom)
        val circleLoop = uptownTrail.copy(paths = listOf(listOf(closedTo, MapPoint(40.509601, -88.984369), closedTo)))

        val network = TrailRouteClosureSijko.openFeatures(listOf(collegiate, circleLoop), September27)

        assertEquals(listOf(collegiate, circleLoop), network.features)
        assertTrue(network.appliedClosures.isEmpty())
    }

    @Test
    fun routesUseAnOpenAlternativeInsteadOfTheClosedSection() {
        val features = listOf(uptownTrail) + alternative

        val route = assertNotNull(findRoute(features, September27))

        assertTrue(route.segments.flatMap { it.points }.none { it == middle })
        assertTrue(TrailRouteAdvisorySijko.forRoute(route, September27).isEmpty())
    }

    @Test
    fun reportsTheClosureWhenNoRouteAvoidsIt() {
        val outcome = TrailRouteCalculationSijko.findRouteOutcome(
            features = listOf(uptownTrail),
            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
            startPoint = south,
            destinationPoint = north,
            accessGraph = null,
            nowEpochMillis = September27,
        )

        assertNull(outcome.route)
        assertEquals(listOf(closure), outcome.blockingClosures)
        assertTrue(closure.guidance.contains("dismount and walk your bike"))
        assertTrue(closure.guidance.contains("does not route this detour"))
        // Far past the June 2028 construction target, the closure still applies until reviewed.
        assertNull(findRoute(listOf(uptownTrail), 1_845_000_000_000L))
    }

    @Test
    fun routesThroughBeforeTheClosureStarts() {
        val route = assertNotNull(findRoute(listOf(uptownTrail), September20))

        assertTrue(route.segments.flatMap { it.points }.contains(middle))
        assertTrue(
            TrailRouteCalculationSijko.findRouteOutcome(
                listOf(uptownTrail), RouteLayerDefaultsSijko.defaultSelection(), south, north, null, nowEpochMillis = September20,
            ).blockingClosures.isEmpty(),
        )
    }

    private fun findRoute(features: List<TrailNetworkFeature>, now: Long) = TrailRouteCalculationSijko.findRoute(
        features = features,
        routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
        startPoint = south,
        destinationPoint = north,
        accessGraph = null,
        nowEpochMillis = now,
    )

    private fun feature(id: String, vararg points: MapPoint) = TrailNetworkFeature(
        id = id,
        status = TrailFeatureStatus.Existing,
        routeRoles = setOf(TrailNetworkRole.TrailBranches),
        facilityType = TrailFacilityType.UrbanTrail,
        comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
        paths = listOf(points.toList()),
    )

    private val closure = TrailRouteClosureSijko.uptownUnderpass
    private val closedFrom = closure.closedFrom
    private val closedTo = closure.closedTo
    private val south = MapPoint(40.504950, -88.983974)
    private val middle = MapPoint(40.508292, -88.983692)
    private val north = MapPoint(40.510500, -88.984100)
    private val uptownTrail = feature("54:1305", south, closedFrom, middle, closedTo, north)

    // An open parallel trail about 300 m east, joined to the closed trail's ends by connectors.
    private val alternative = listOf(
        feature("east-connector-south", south, MapPoint(40.504950, -88.980400)),
        feature("east-trail", MapPoint(40.504950, -88.980400), MapPoint(40.510500, -88.980400)),
        feature("east-connector-north", MapPoint(40.510500, -88.980400), north),
    )

    private companion object {
        const val September20 = 1_789_905_600_000L
        const val September27 = 1_790_528_400_000L
    }
}
