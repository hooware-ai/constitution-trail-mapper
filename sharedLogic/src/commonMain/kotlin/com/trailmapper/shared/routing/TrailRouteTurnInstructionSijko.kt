/**
 * Job: Generate turn-by-turn navigation instructions from constrained trail route geometry.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.abs

object TrailRouteTurnInstructionSijko {
    fun instructionsFor(route: TrailRoute): List<TrailRouteInstruction> {
        val legs = TrailRouteInstructionLegSijko.legsFor(route)
        if (legs.isEmpty()) {
            return emptyList()
        }

        val instructions = mutableListOf(
            TrailRouteInstruction(
                maneuver = TrailRouteInstructionManeuver.Start,
                text = "Start on ${legs.first().routeLabel()}",
                distanceMeters = 0.0,
                point = legs.first().start,
            ),
        )
        var mappedDistanceSinceLastInstruction = 0.0

        for (index in 1 until legs.size) {
            val previous = legs[index - 1]
            val current = legs[index]
            val next = legs.getOrNull(index + 1)
            mappedDistanceSinceLastInstruction += previous.distanceMeters

            // A reversal always gets its own instruction, even on a short unnamed spur.
            if (current.startsWithReversal) {
                instructions += TrailRouteInstruction(
                    maneuver = TrailRouteInstructionManeuver.TurnAround,
                    text = "Turn around on ${current.routeLabel()}",
                    distanceMeters = mappedDistanceSinceLastInstruction,
                    point = current.start,
                )
                mappedDistanceSinceLastInstruction = 0.0
                continue
            }

            if (TrailRouteInstructionTransientLegSijko.shouldDeferTransition(current, next)) {
                continue
            }

            val semanticTransition = previous.hasSemanticTransitionTo(current)
            val turnManeuver = if (previous.isDifferentSemanticLegFrom(current) || current.startsAtJunctionTurn) {
                maneuverFor(previous.exitBearingDegrees, current.entryBearingDegrees)
            } else {
                null
            }
            if (semanticTransition || turnManeuver != null) {
                val maneuver = turnManeuver ?: TrailRouteInstructionManeuver.Continue
                instructions += TrailRouteInstruction(
                    maneuver = maneuver,
                    text = instructionText(
                        maneuver = maneuver,
                        previous = previous,
                        current = current,
                    ),
                    distanceMeters = mappedDistanceSinceLastInstruction,
                    point = current.start,
                )
                mappedDistanceSinceLastInstruction = 0.0
            }
        }

        mappedDistanceSinceLastInstruction += legs.last().distanceMeters
        instructions += TrailRouteInstruction(
            maneuver = TrailRouteInstructionManeuver.Arrive,
            text = if (route.kind == TrailRouteKind.ExerciseLoop) {
                "Return to start"
            } else {
                "Arrive at destination"
            },
            distanceMeters = mappedDistanceSinceLastInstruction,
            point = route.destinationEndpoint() ?: legs.last().end,
        )

        return instructions
    }

    private fun TrailRoute.destinationEndpoint() = segments
        .asReversed()
        .firstNotNullOfOrNull { segment -> segment.points.lastOrNull() }

    private fun TrailRouteInstructionLeg.hasSemanticTransitionTo(
        next: TrailRouteInstructionLeg,
    ): Boolean {
        return segmentType != next.segmentType ||
            routeRoles != next.routeRoles ||
            displayStyle != next.displayStyle ||
            !TrailRouteNameSijko.matches(name, next.name)
    }

    private fun TrailRouteInstructionLeg.isDifferentSemanticLegFrom(
        next: TrailRouteInstructionLeg,
    ): Boolean {
        return segmentType != next.segmentType || !TrailRouteNameSijko.matches(name, next.name)
    }

    private fun maneuverFor(
        previousBearingDegrees: Double,
        currentBearingDegrees: Double,
    ): TrailRouteInstructionManeuver? {
        val delta = turnDeltaDegrees(previousBearingDegrees, currentBearingDegrees)
        val absoluteDelta = abs(delta)
        if (absoluteDelta < TURN_INSTRUCTION_THRESHOLD_DEGREES) {
            return null
        }

        val rightTurn = delta > 0.0
        return when {
            absoluteDelta >= SHARP_TURN_THRESHOLD_DEGREES && rightTurn -> TrailRouteInstructionManeuver.SharpRight
            absoluteDelta >= SHARP_TURN_THRESHOLD_DEGREES -> TrailRouteInstructionManeuver.SharpLeft
            absoluteDelta >= STANDARD_TURN_THRESHOLD_DEGREES && rightTurn -> TrailRouteInstructionManeuver.TurnRight
            absoluteDelta >= STANDARD_TURN_THRESHOLD_DEGREES -> TrailRouteInstructionManeuver.TurnLeft
            rightTurn -> TrailRouteInstructionManeuver.SlightRight
            else -> TrailRouteInstructionManeuver.SlightLeft
        }
    }

    private fun instructionText(
        maneuver: TrailRouteInstructionManeuver,
        previous: TrailRouteInstructionLeg,
        current: TrailRouteInstructionLeg,
    ): String {
        if (maneuver == TrailRouteInstructionManeuver.Continue) {
            return when {
                current.entersSharedRoadwayFrom(previous) -> current.name?.let { name ->
                    "Enter shared roadway on $name"
                } ?: "Enter Suggested Shared Roadway"
                current.entersProposedTrailFrom(previous) -> current.name?.let { name ->
                    "Enter proposed trail $name"
                } ?: "Enter proposed trail"
                previous.isSharedRoadway() && !current.isSharedRoadway() -> "Join ${current.routeLabel()}"
                previous.segmentType == TrailRouteSegmentType.Access &&
                    current.segmentType == TrailRouteSegmentType.Trail -> "Enter ${current.routeLabel()}"
                previous.segmentType == TrailRouteSegmentType.Trail &&
                    current.segmentType == TrailRouteSegmentType.Access -> "Exit to ${current.routeLabel()}"
                else -> "Continue onto ${current.routeLabel()}"
            }
        }

        // "Stay on" only when nothing but direction changes; a role or style change keeps the usual wording.
        if (current.startsAtJunctionTurn && !previous.hasSemanticTransitionTo(current)) {
            return "${maneuver.turnText()} to stay on ${current.routeLabel()}"
        }
        return "${maneuver.turnText()} onto ${current.routeLabel()}"
    }

    private fun TrailRouteInstructionLeg.entersSharedRoadwayFrom(
        previous: TrailRouteInstructionLeg,
    ): Boolean {
        return isSharedRoadway() && !previous.isSharedRoadway()
    }

    private fun TrailRouteInstructionLeg.entersProposedTrailFrom(
        previous: TrailRouteInstructionLeg,
    ): Boolean {
        return TrailNetworkRole.ProposedTrails in routeRoles &&
            TrailNetworkRole.ProposedTrails !in previous.routeRoles
    }

    private fun TrailRouteInstructionLeg.isSharedRoadway(): Boolean {
        return TrailNetworkRole.SharedRoadways in routeRoles
    }

    private fun TrailRouteInstructionManeuver.turnText(): String {
        return when (this) {
            TrailRouteInstructionManeuver.SlightLeft -> "Slight left"
            TrailRouteInstructionManeuver.TurnLeft -> "Turn left"
            TrailRouteInstructionManeuver.SharpLeft -> "Sharp left"
            TrailRouteInstructionManeuver.SlightRight -> "Slight right"
            TrailRouteInstructionManeuver.TurnRight -> "Turn right"
            TrailRouteInstructionManeuver.SharpRight -> "Sharp right"
            TrailRouteInstructionManeuver.TurnAround -> "Turn around"
            else -> "Continue"
        }
    }

    private fun TrailRouteInstructionLeg.routeLabel(): String {
        name?.let { return it }

        if (segmentType == TrailRouteSegmentType.Access) {
            return "mapped access road"
        }

        return when (displayStyle) {
            TrailRouteDisplayStyle.BloomerLine -> "Bloomer Line"
            TrailRouteDisplayStyle.Collegiate -> "Collegiate"
            TrailRouteDisplayStyle.IllinoisCentral -> "Illinois Central"
            TrailRouteDisplayStyle.Interurban -> "Interurban"
            TrailRouteDisplayStyle.Northtown -> "Northtown"
            TrailRouteDisplayStyle.Route66 -> "Route 66"
            TrailRouteDisplayStyle.Route66Advanced -> "Route 66 - Advanced"
            TrailRouteDisplayStyle.Route66Alternate -> "Route 66 - Alternate"
            TrailRouteDisplayStyle.Route66IllinoisCentral -> "Route 66 & Illinois Central"
            TrailRouteDisplayStyle.Route66Southtown -> "Route 66 & Southtown"
            TrailRouteDisplayStyle.Southtown -> "Southtown"
            TrailRouteDisplayStyle.Proposed -> "proposed trail"
            TrailRouteDisplayStyle.ParkTrailConnectors -> "Park Trail & Connector"
            TrailRouteDisplayStyle.SuggestedSharedRoadways -> "Suggested Shared Roadway"
            TrailRouteDisplayStyle.Unknown -> fallbackRouteLabel()
        }
    }

    private fun TrailRouteInstructionLeg.fallbackRouteLabel(): String {
        return when {
            TrailNetworkRole.SharedRoadways in routeRoles -> "Suggested Shared Roadway"
            TrailNetworkRole.ParkConnectors in routeRoles -> "Park Trail & Connector"
            TrailNetworkRole.TrailBranches in routeRoles -> "trail branch"
            else -> "trail"
        }
    }

    private fun turnDeltaDegrees(
        previousBearingDegrees: Double,
        currentBearingDegrees: Double,
    ): Double {
        return (currentBearingDegrees - previousBearingDegrees + HALF_CIRCLE_DEGREES + FULL_CIRCLE_DEGREES) %
            FULL_CIRCLE_DEGREES - HALF_CIRCLE_DEGREES
    }

    private const val TURN_INSTRUCTION_THRESHOLD_DEGREES = 35.0
    private const val STANDARD_TURN_THRESHOLD_DEGREES = 60.0
    private const val SHARP_TURN_THRESHOLD_DEGREES = 135.0
    private const val HALF_CIRCLE_DEGREES = 180.0
    private const val FULL_CIRCLE_DEGREES = 360.0
}
