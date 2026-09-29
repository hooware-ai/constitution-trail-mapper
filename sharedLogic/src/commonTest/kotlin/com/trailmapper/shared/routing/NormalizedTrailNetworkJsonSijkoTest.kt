package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NormalizedTrailNetworkJsonSijkoTest {
    @Test
    fun acceptsTheBomWrittenByWindowsPowerShellExtractors() {
        assertTrue(NormalizedTrailNetworkJsonSijko.features("\uFEFF{\"layers\":[]}").isEmpty())
    }

    @Test
    fun preservesSeparatePathsCoordinateOrderAndProposedOptIn() {
        val features = NormalizedTrailNetworkJsonSijko.features(
            """{"layers":[{"features":[
              {"id":"54:1","name":null,"status":"Proposed","routeRoles":["TrailBranches","ProposedTrails"],
               "facilityType":"Urban Trail","comfort":"All Ages and Abilities",
               "paths":[[[-89.0,40.5],[-89.0,40.51]],[[-89.1,40.5],[-89.1,40.51]]]},
              {"id":"verified-osm:way:1","name":"Local path","status":"Existing","routeRoles":"ParkConnectors",
               "facilityType":"Off-Road Trail","comfort":"Unknown","paths":[[[-89.2,40.5],[-89.2,40.51]]],
               "provenance":{"license":"ODbL 1.0"}}
            ]}]}""",
        )
        assertEquals(MapPoint(40.5, -89.0), features.first().paths.first().first())
        assertEquals(2, features.first().paths.size)
        assertEquals(TrailFacilityType.UrbanTrail, features.first().facilityType)
        assertEquals(TrailComfortLevel.AllAgesAndAbilities, features.first().comfortLevel)
        val default = RouteLayerDefaultsSijko.defaultSelection()
        assertEquals(listOf("verified-osm:way:1"), TrailFeatureFilterSijko.enabledFeatures(features, default).map { it.id })
        assertTrue(TrailFeatureFilterSijko.enabledFeatures(features, default.copy(parkConnectors = false)).isEmpty())
        assertEquals(2, TrailFeatureFilterSijko.enabledFeatures(features, default.copy(proposedTrails = true)).size)
    }
}
