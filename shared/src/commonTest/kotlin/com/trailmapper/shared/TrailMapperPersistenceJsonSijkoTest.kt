/**
 * Job: Verify durable saved-item JSON retains route graph metadata and rejects invalid data.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailComfortLevel
import com.trailmapper.shared.routing.TrailFacilityType
import com.trailmapper.shared.routing.TrailFeatureStatus
import com.trailmapper.shared.routing.TrailGraphEdge
import com.trailmapper.shared.routing.TrailNetworkRole
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteDisplayStyle
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.routing.TrailRouteSegmentType
import com.trailmapper.shared.routing.TrailRouteTraversalEdge
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrailMapperPersistenceJsonSijkoTest {
    @Test
    fun roundTripsSavedDestinations() {
        val destinations = listOf(
            SavedDestination(
                id = "destination-1",
                title = "Home",
                address = "100 Example Street, Bloomington, IL",
                point = MapPoint(latitude = 40.4001, longitude = -89.0001),
            ),
            SavedDestination(
                id = "destination-2",
                title = "Trailhead",
                address = "100 Example Avenue, Normal, IL",
                point = MapPoint(latitude = 40.5102, longitude = -88.9893),
            ),
        )

        assertEquals(
            expected = destinations,
            actual = TrailMapperPersistenceJsonSijko.decodeDestinations(
                TrailMapperPersistenceJsonSijko.encodeDestinations(destinations),
            ),
        )
    }

    @Test
    fun roundTripsSavedRoutesWithAllPersistedGraphAndGeometryMetadata() {
        val routes = listOf(savedRoute())

        assertEquals(
            expected = routes,
            actual = TrailMapperPersistenceJsonSijko.decodeRoutes(
                TrailMapperPersistenceJsonSijko.encodeRoutes(routes),
            ),
        )
    }

    @Test
    fun roundTripsTheRoutePlanningLayersAndReadsOlderRoutesWithout() {
        val layers = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = true)
        val withLayers = savedRoute().let { saved -> saved.copy(route = saved.route.copy(routeLayers = layers)) }

        val decoded = TrailMapperPersistenceJsonSijko.decodeRoutes(
            TrailMapperPersistenceJsonSijko.encodeRoutes(listOf(withLayers)),
        )?.single()
        assertEquals(layers, decoded?.route?.routeLayers)

        // A route saved before layers were recorded has no "routeLayers" field at all.
        val legacyJson = TrailMapperPersistenceJsonSijko.encodeRoutes(listOf(savedRoute()))
            .replace(",\"routeLayers\":null", "")
        assertTrue("routeLayers" !in legacyJson)
        assertEquals(null, TrailMapperPersistenceJsonSijko.decodeRoutes(legacyJson)?.single()?.route?.routeLayers)
    }

    @Test
    fun roundTripsRouteSegmentNames() {
        val decodedRoute = TrailMapperPersistenceJsonSijko.decodeRoutes(
            TrailMapperPersistenceJsonSijko.encodeRoutes(listOf(savedRoute())),
        )?.single()?.route

        assertEquals(
            expected = listOf("Constitution Trail", "Oak Street"),
            actual = decodedRoute?.segments?.map { segment -> segment.name },
        )
        assertEquals(
            expected = listOf("Constitution Trail", "Oak Street"),
            actual = decodedRoute?.edges?.first()?.routeSegments?.map { segment -> segment.name },
        )
    }

    @Test
    fun roundTripsCompletedExerciseSessions() {
        val sessions = listOf(
            CompletedExerciseSession(
                id = "session-1",
                routeKey = "loop-a",
                completedAtEpochMillis = 1_721_000_000_000L,
                completedDistanceMeters = 8_046.72,
                traversalEdges = listOf(
                    TrailRouteTraversalEdge(
                        key = "feature-1:40.0,-89.0:40.1,-89.1",
                        distanceMeters = 325.0,
                    ),
                ),
            ),
        )

        assertEquals(
            expected = sessions,
            actual = TrailMapperPersistenceJsonSijko.decodeCompletedExerciseSessions(
                TrailMapperPersistenceJsonSijko.encodeCompletedExerciseSessions(sessions),
            ),
        )
    }

    @Test
    fun ignoresUnknownFieldsForForwardCompatibility() {
        val destinations = """
            [
              {
                "id":"destination-1",
                "title":"Home",
                "address":"100 Example Street",
                "point":{"latitude":40.4001,"longitude":-89.0001,"futurePoint":"ignored"},
                "futureDestination":"ignored"
              }
            ]
        """.trimIndent()

        assertEquals(
            expected = listOf(
                SavedDestination(
                    id = "destination-1",
                    title = "Home",
                    address = "100 Example Street",
                    point = MapPoint(latitude = 40.4001, longitude = -89.0001),
                ),
            ),
            actual = TrailMapperPersistenceJsonSijko.decodeDestinations(destinations),
        )
    }

    @Test
    fun decodesLegacyRoutesWithoutEdges() {
        val routes = """
            [
              {
                "id":"route-1",
                "title":"Legacy route",
                "summary":"1.0 total miles.",
                "route":{
                  "segments":[
                    {
                      "type":"Trail",
                      "points":[
                        {"latitude":40.0,"longitude":-89.0},
                        {"latitude":40.1,"longitude":-89.1}
                      ],
                      "isRouted":true,
                      "routeRoles":["TrailBranches"],
                      "displayStyle":"BloomerLine"
                    }
                  ],
                  "totalDistanceMeters":1609.344,
                  "ordinaryAccessDistanceMeters":0.0,
                  "sharedRoadwayDistanceMeters":0.0,
                  "totalCost":1609.344
                }
              }
            ]
        """.trimIndent()

        assertEquals(
            expected = emptyList(),
            actual = TrailMapperPersistenceJsonSijko.decodeRoutes(routes)
                ?.single()
                ?.route
                ?.edges,
        )
        assertNull(
            TrailMapperPersistenceJsonSijko.decodeRoutes(routes)
                ?.single()
                ?.route
                ?.segments
                ?.single()
                ?.name,
        )
        assertEquals(
            expected = TrailRouteKind.Navigation,
            actual = TrailMapperPersistenceJsonSijko.decodeRoutes(routes)
                ?.single()
                ?.route
                ?.kind,
        )
        assertEquals(
            expected = emptyList(),
            actual = TrailMapperPersistenceJsonSijko.decodeRoutes(routes)
                ?.single()
                ?.route
                ?.traversalEdges,
        )
    }

    @Test
    fun rejectsAnEntireMalformedPayload() {
        val destinations = """
            [
              {
                "id":"destination-1",
                "title":"Home",
                "address":"100 Example Street",
                "point":{"latitude":40.4001,"longitude":-89.0001}
              },
              {
                "id":"destination-2",
                "title":"Trailhead",
                "address":"100 Example Avenue",
                "point":{"latitude":"not-a-number","longitude":-88.9893}
              }
            ]
        """.trimIndent()

        assertNull(TrailMapperPersistenceJsonSijko.decodeDestinations(destinations))
    }

    private fun savedRoute(): SavedTrailRoute {
        val trailSegment = TrailRouteSegment(
            type = TrailRouteSegmentType.Trail,
            points = listOf(
                MapPoint(latitude = 40.4001, longitude = -89.0001),
                MapPoint(latitude = 40.4594, longitude = -88.9352),
            ),
            isRouted = true,
            routeRoles = setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.ParkConnectors),
            displayStyle = TrailRouteDisplayStyle.BloomerLine,
            name = "Constitution Trail",
        )
        val accessSegment = TrailRouteSegment(
            type = TrailRouteSegmentType.Access,
            points = listOf(
                MapPoint(latitude = 40.4594, longitude = -88.9352),
                MapPoint(latitude = 40.4610, longitude = -88.9338),
            ),
            isRouted = false,
            routeRoles = setOf(TrailNetworkRole.SharedRoadways),
            displayStyle = TrailRouteDisplayStyle.SuggestedSharedRoadways,
            name = "Oak Street",
        )
        val route = TrailRoute(
            edges = listOf(
                TrailGraphEdge(
                    id = 17,
                    fromNodeId = 4,
                    toNodeId = 8,
                    distanceMeters = 242.75,
                    ordinaryAccessDistanceMeters = 24.25,
                    accessRoadClass = "residential",
                    sourceFeatureId = "constitution-trail-17",
                    routeRoles = setOf(TrailNetworkRole.TrailBranches, TrailNetworkRole.SharedRoadways),
                    facilityType = TrailFacilityType.SeparatedTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    status = TrailFeatureStatus.Existing,
                    routeSegments = listOf(trailSegment, accessSegment),
                ),
                TrailGraphEdge(
                    id = 18,
                    fromNodeId = 8,
                    toNodeId = 12,
                    distanceMeters = 75.0,
                    ordinaryAccessDistanceMeters = 75.0,
                    accessRoadClass = null,
                    sourceFeatureId = null,
                    routeRoles = setOf(TrailNetworkRole.ProposedTrails),
                    facilityType = TrailFacilityType.Unknown,
                    comfortLevel = TrailComfortLevel.Unknown,
                    status = TrailFeatureStatus.Proposed,
                    routeSegments = emptyList(),
                ),
            ),
            segments = listOf(trailSegment, accessSegment),
            totalDistanceMeters = 317.75,
            ordinaryAccessDistanceMeters = 99.25,
            sharedRoadwayDistanceMeters = 18.5,
            totalCost = 418.0,
        )
        return SavedTrailRoute(
            id = "route-1",
            title = "Ride to Downtown",
            summary = "Trail route found: 0.14 trail/connector miles, 0.2 total miles.",
            route = route,
        )
    }
}
