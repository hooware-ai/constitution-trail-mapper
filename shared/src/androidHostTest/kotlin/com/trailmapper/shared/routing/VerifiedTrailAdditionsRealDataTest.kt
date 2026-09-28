package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class VerifiedTrailAdditionsRealDataTest {
    private val defaults = RouteLayerDefaultsSijko.defaultSelection()
    private val additions by lazy { load("verified-trail-additions.normalized.json") }
    private val county by lazy { load("mcgis-trails.normalized.json") }

    @Test
    fun newMorrisPathRoutesAsTrailAndConnectsToExistingRoute66() {
        val morris = additions.single { it.id == "verified-osm:way:1424898800" }
        val path = morris.paths.single()
        val route = assertNotNull(TrailRouteCalculationSijko.findRoute(
            county + additions, defaults, path.first(), path.last(), accessGraph = null,
        ))
        assertTrue(route.edges.any { it.sourceFeatureId == morris.id })
        assertTrue(route.totalDistanceMeters < 145.0, "The 114-meter path should replace the longer shared-road detour")
        val graph = TrailGraphBuilderSijko.buildGraph(TrailFeatureFilterSijko.enabledFeatures(county + additions, defaults))
        val reachable = component(graph, graph.edges.first { it.sourceFeatureId == morris.id }.fromNodeId)
        assertTrue(graph.edges.any { it.sourceFeatureId == "54:1907" && it.fromNodeId in reachable })
        assertTrue(graph.edges.any { it.sourceFeatureId == "54:1899" && it.fromNodeId in reachable })
    }

    @Test
    fun pondCircuitIsUsableLocallyWithoutInventingTheMissingRaabConnection() {
        val heartland = additions.filter { TrailNetworkRole.ParkConnectors in it.routeRoles }
        assertEquals(3, heartland.size)
        val start = heartland.first().paths.single().first()
        val result = assertNotNull(ExerciseRouteCalculationSijko.findRoute(
            features = heartland,
            routeLayers = defaults,
            startPoint = start,
            targetDistanceMeters = 1_300.0,
            completedSessions = emptyList(),
            accessGraph = null,
            nowEpochMillis = 1_788_739_200_000L,
        ))
        assertTrue(result.route.edges.any { it.sourceFeatureId?.startsWith("verified-osm:") == true })
        assertTrue(result.route.totalDistanceMeters in 1_100.0..1_500.0)
        val graph = TrailGraphBuilderSijko.buildGraph(TrailFeatureFilterSijko.enabledFeatures(county + additions, defaults))
        val pondComponent = component(graph, graph.edges.first { it.sourceFeatureId == heartland.first().id }.fromNodeId)
        assertFalse(graph.edges.any { it.sourceFeatureId == "54:68" && it.fromNodeId in pondComponent },
            "Do not manufacture a route across the unmapped Raab Road access gap")
    }

    @Test
    fun additionsKeepTheirReviewedRoutingRolesAndDoNotEnableProposals() {
        assertEquals(4, additions.size)
        assertTrue(additions.all { it.status == TrailFeatureStatus.Existing })
        assertEquals(1, TrailFeatureFilterSijko.enabledFeatures(additions, defaults.copy(parkConnectors = false)).size)
        assertEquals(3, TrailFeatureFilterSijko.enabledFeatures(additions, defaults.copy(trailBranches = false)).size)
        assertTrue(TrailFeatureFilterSijko.enabledFeatures(county + additions, defaults).none { it.status == TrailFeatureStatus.Proposed })
    }

    private fun component(graph: TrailGraph, start: Int): Set<Int> {
        val neighbors = mutableMapOf<Int, MutableSet<Int>>()
        graph.edges.forEach {
            neighbors.getOrPut(it.fromNodeId) { mutableSetOf() }.add(it.toNodeId)
            neighbors.getOrPut(it.toNodeId) { mutableSetOf() }.add(it.fromNodeId)
        }
        val visited = mutableSetOf(start)
        val pending = ArrayDeque<Int>()
        pending.add(start)
        while (pending.isNotEmpty()) {
            neighbors[pending.removeFirst()].orEmpty().forEach { if (visited.add(it)) pending.add(it) }
        }
        return visited
    }

    private fun load(name: String): List<TrailNetworkFeature> {
        var directory = File(requireNotNull(System.getProperty("user.dir"))).absoluteFile
        repeat(5) {
            val candidate = directory.resolve("data/generated/$name")
            if (candidate.isFile) return NormalizedTrailNetworkJsonSijko.features(candidate.readText())
            directory = directory.parentFile ?: return@repeat
        }
        error("Missing generated trail asset: $name")
    }
}
