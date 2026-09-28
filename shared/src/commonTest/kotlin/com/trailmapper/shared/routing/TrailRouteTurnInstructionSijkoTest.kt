/**
 * Job: Verify trail route geometry becomes stable turn-by-turn navigation instructions.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailRouteTurnInstructionSijkoTest {
    @Test
    fun exerciseLoopReturnsToItsStart() {
        val route = routeWith(
            TrailRouteSegment(
                type = TrailRouteSegmentType.Trail,
                points = listOf(
                    MapPoint(latitude = 40.0, longitude = -89.0),
                    MapPoint(latitude = 40.0, longitude = -88.999),
                    MapPoint(latitude = 40.001, longitude = -88.999),
                    MapPoint(latitude = 40.0, longitude = -89.0),
                ),
            ),
        ).copy(kind = TrailRouteKind.ExerciseLoop)

        assertEquals(
            "Return to start",
            TrailRouteTurnInstructionSijko.instructionsFor(route).last().text,
        )
    }

    @Test
    fun straightRouteReturnsStartAndArrivalOnly() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.001, longitude = -89.0)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(start, destination),
                    displayStyle = TrailRouteDisplayStyle.Route66,
                ),
            ),
        )

        assertEquals(TrailRouteInstructionManeuver.Start, instructions.first().maneuver)
        assertEquals("Start on Route 66", instructions.first().text)
        assertEquals(TrailRouteInstructionManeuver.Arrive, instructions.last().maneuver)
        assertEquals(2, instructions.size)
    }

    @Test
    fun namedStreetTurnReturnsTurnInstruction() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val corner = MapPoint(latitude = 40.001, longitude = -89.0)
        val destination = MapPoint(latitude = 40.001, longitude = -88.999)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(start, corner),
                    name = "Oak Street",
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(corner, destination),
                    name = "Main Street",
                ),
            ),
        )

        assertEquals(
            TrailRouteInstructionManeuver.TurnRight,
            instructions[1].maneuver,
        )
        assertEquals("Turn right onto Main Street", instructions[1].text)
        assertEquals(corner, instructions[1].point)
        assertTrue(instructions[1].distanceMeters > 0.0)
    }

    @Test
    fun sameNamedSharpBendDoesNotCreateAnInstruction() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val corner = MapPoint(latitude = 40.001, longitude = -89.0)
        val destination = MapPoint(latitude = 40.001, longitude = -88.999)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(start, corner, destination),
                    name = "Constitution Trail",
                ),
            ),
        )

        assertEquals(2, instructions.size)
        assertEquals(TrailRouteInstructionManeuver.Arrive, instructions.last().maneuver)
    }

    @Test
    fun pathTypeTransitionReturnsEnterInstructionWithoutInventingATurn() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val trailEntry = MapPoint(latitude = 40.001, longitude = -89.0)
        val destination = MapPoint(latitude = 40.002, longitude = -89.0)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(start, trailEntry),
                    name = "Main Street",
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(trailEntry, destination),
                    displayStyle = TrailRouteDisplayStyle.Route66,
                    name = "Constitution Trail",
                ),
            ),
        )

        assertEquals(TrailRouteInstructionManeuver.Continue, instructions[1].maneuver)
        assertEquals("Start on Main Street", instructions.first().text)
        assertEquals("Enter Constitution Trail", instructions[1].text)
    }

    @Test
    fun sharedRoadwayTransitionNamesTheNewPathType() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val transition = MapPoint(latitude = 40.001, longitude = -89.0)
        val destination = MapPoint(latitude = 40.002, longitude = -89.0)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(start, transition),
                    routeRoles = setOf(TrailNetworkRole.TrailBranches),
                    name = "Route 66",
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(transition, destination),
                    routeRoles = setOf(TrailNetworkRole.SharedRoadways),
                    name = "Route 66",
                ),
            ),
        )

        assertEquals(TrailRouteInstructionManeuver.Continue, instructions[1].maneuver)
        assertEquals("Enter shared roadway on Route 66", instructions[1].text)
    }

    @Test
    fun officialTrailNameTakesPrecedenceOverDisplayStyle() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.001, longitude = -89.0)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(start, destination),
                    displayStyle = TrailRouteDisplayStyle.Route66,
                    name = "Constitution Trail",
                ),
            ),
        )

        assertEquals("Start on Constitution Trail", instructions.first().text)
    }

    @Test
    fun unnamedSegmentUsesDisplayStyleFallback() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.001, longitude = -89.0)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(start, destination),
                    displayStyle = TrailRouteDisplayStyle.ParkTrailConnectors,
                ),
            ),
        )

        assertEquals("Start on Park Trail & Connector", instructions.first().text)
    }

    @Test
    fun estimatedStartAndEndAreSuppressedWhileArrivalUsesDestinationEndpoint() {
        val routeStart = MapPoint(latitude = 40.0, longitude = -89.0)
        val mappedStart = MapPoint(latitude = 40.001, longitude = -89.0)
        val mappedEnd = MapPoint(latitude = 40.002, longitude = -89.0)
        val destination = MapPoint(latitude = 40.003, longitude = -89.0)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(routeStart, mappedStart),
                    isRouted = false,
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(mappedStart, mappedEnd),
                    name = "Constitution Trail",
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(mappedEnd, destination),
                    isRouted = false,
                ),
            ),
        )

        assertEquals(2, instructions.size)
        assertEquals("Start on Constitution Trail", instructions.first().text)
        assertEquals(mappedStart, instructions.first().point)
        assertEquals(destination, instructions.last().point)
    }

    @Test
    fun instructionDistancesExcludeEstimatedAccessGaps() {
        val routeStart = MapPoint(latitude = 40.0, longitude = -89.0)
        val firstMappedStart = MapPoint(latitude = 40.001, longitude = -89.0)
        val nameChange = MapPoint(latitude = 40.002, longitude = -89.0)
        val lastMappedEnd = MapPoint(latitude = 40.003, longitude = -89.0)
        val destination = MapPoint(latitude = 40.004, longitude = -89.0)
        val firstMappedPoints = listOf(firstMappedStart, nameChange)
        val secondMappedPoints = listOf(nameChange, lastMappedEnd)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(routeStart, firstMappedStart),
                    isRouted = false,
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = firstMappedPoints,
                    name = "First Street",
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = secondMappedPoints,
                    name = "Second Street",
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(lastMappedEnd, destination),
                    isRouted = false,
                ),
            ),
        )

        assertEquals(3, instructions.size)
        assertEquals("Continue onto Second Street", instructions[1].text)
        assertEquals(
            TrailDistanceSijko.pathLengthMeters(firstMappedPoints),
            instructions[1].distanceMeters,
            absoluteTolerance = 0.001,
        )
        assertEquals(
            TrailDistanceSijko.pathLengthMeters(secondMappedPoints),
            instructions.last().distanceMeters,
            absoluteTolerance = 0.001,
        )
    }

    @Test
    fun tinyUnnamedConnectorDefersToNextNamedRoad() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val connectorStart = MapPoint(latitude = 40.001, longitude = -89.0)
        val namedRoadStart = MapPoint(latitude = 40.00105, longitude = -89.0)
        val destination = MapPoint(latitude = 40.002, longitude = -89.0)
        val firstLegPoints = listOf(start, connectorStart)
        val connectorPoints = listOf(connectorStart, namedRoadStart)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = firstLegPoints,
                    name = "Illinois Central",
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = connectorPoints,
                ),
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(namedRoadStart, destination),
                    name = "E University Ave",
                ),
            ),
        )

        assertEquals(3, instructions.size)
        assertEquals("Continue onto E University Ave", instructions[1].text)
        assertEquals(
            TrailDistanceSijko.pathLengthMeters(firstLegPoints) +
                TrailDistanceSijko.pathLengthMeters(connectorPoints),
            instructions[1].distanceMeters,
            absoluteTolerance = 0.001,
        )
        assertTrue(instructions.none { instruction -> "mapped access road" in instruction.text })
    }

    @Test
    fun duplicatePointsDoNotSplitASemanticLeg() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.001, longitude = -89.0)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Trail,
                    points = listOf(start, start, destination),
                    name = "Constitution Trail",
                ),
            ),
        )

        assertEquals(2, instructions.size)
        assertEquals("Start on Constitution Trail", instructions.first().text)
        assertEquals(TrailRouteInstructionManeuver.Arrive, instructions.last().maneuver)
    }

    @Test
    fun allEstimatedAccessRouteReturnsNoInstructions() {
        val start = MapPoint(latitude = 40.0, longitude = -89.0)
        val destination = MapPoint(latitude = 40.001, longitude = -89.0)

        val instructions = TrailRouteTurnInstructionSijko.instructionsFor(
            routeWith(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    points = listOf(start, destination),
                    isRouted = false,
                ),
            ),
        )

        assertTrue(instructions.isEmpty())
    }

    @Test
    fun distanceLabelsStayCompact() {
        assertEquals("Now", TrailRouteInstructionDistanceSijko.labelFor(0.0))
        assertEquals("325 ft", TrailRouteInstructionDistanceSijko.labelFor(100.0))
        assertEquals("0.6 mi", TrailRouteInstructionDistanceSijko.labelFor(1000.0))
    }

    private fun routeWith(vararg segments: TrailRouteSegment): TrailRoute {
        return TrailRoute(
            edges = emptyList(),
            segments = segments.toList(),
            totalDistanceMeters = segments.sumOf { segment -> TrailDistanceSijko.pathLengthMeters(segment.points) },
            ordinaryAccessDistanceMeters = segments
                .filter { segment -> segment.type == TrailRouteSegmentType.Access }
                .sumOf { segment -> TrailDistanceSijko.pathLengthMeters(segment.points) },
            totalCost = 0.0,
        )
    }
}
