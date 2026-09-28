/**
 * Job: Convert live user position into route progress and a forward-looking navigation camera.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

object TrailRouteNavigationSnapshotSijko {
    /** Farther than this from the route, a position is off-route and cannot move progress far. */
    const val OFF_ROUTE_METERS = 50.0

    /**
     * [previousProgressMeters] is the last credible progress on a point-to-point route. While the rider
     * is off-route, a projection far from it is not trusted: an off-route position can project onto any
     * distant part of the route. Exercise loops hold progress the same way from [minimumProgressMeters].
     */
    fun snapshotFor(
        route: TrailRoute,
        instructions: List<TrailRouteInstruction>,
        userPoint: MapPoint,
        minimumProgressMeters: Double = 0.0,
        previousProgressMeters: Double? = null,
    ): TrailRouteNavigationSnapshot? {
        val legs = route.navigationLegs()
        if (legs.isEmpty()) {
            return null
        }

        val routeLengthMeters = legs.last().cumulativeStartMeters + legs.last().distanceMeters
        val nearestRoutePosition = if (route.kind == TrailRouteKind.ExerciseLoop) {
            continuousLoopPosition(
                point = userPoint,
                legs = legs,
                minimumProgressMeters = minimumProgressMeters,
            )
        } else {
            val positions = routePositions(userPoint, legs)
            val nearest = nearestRoutePosition(positions, minimumProgressMeters, BACKTRACK_TOLERANCE_METERS)
            previousProgressMeters
                ?.takeIf { nearest.distanceFromRouteMeters > OFF_ROUTE_METERS }
                ?.let { previous -> heldPosition(userPoint, legs, nearest, previous) }
                ?: nearest
        }
        val lookAheadDistanceMeters = (nearestRoutePosition.distanceAlongRouteMeters + LOOK_AHEAD_METERS)
            .coerceAtMost(routeLengthMeters)
        val lookAheadPoint = pointAtDistance(
            legs = legs,
            distanceAlongRouteMeters = lookAheadDistanceMeters,
        )
        val lookAheadLeg = legAtDistance(
            legs = legs,
            distanceAlongRouteMeters = lookAheadDistanceMeters,
        )
        val nextInstructionPosition = nextInstructionPosition(
            instructions = instructions,
            legs = legs,
            distanceAlongRouteMeters = nearestRoutePosition.distanceAlongRouteMeters,
        )

        return TrailRouteNavigationSnapshot(
            snappedPoint = nearestRoutePosition.point,
            cameraTarget = lookAheadPoint,
            bearingDegrees = lookAheadLeg.bearingDegrees,
            distanceFromRouteMeters = nearestRoutePosition.distanceFromRouteMeters,
            distanceAlongRouteMeters = nearestRoutePosition.distanceAlongRouteMeters,
            routeDistanceMeters = routeLengthMeters,
            remainingDistanceMeters = max(0.0, routeLengthMeters - nearestRoutePosition.distanceAlongRouteMeters),
            nextInstruction = nextInstructionPosition?.instruction,
            nextInstructionIndex = nextInstructionPosition?.index ?: -1,
            distanceToNextInstructionMeters = nextInstructionPosition?.let { position ->
                max(0.0, position.distanceAlongRouteMeters - nearestRoutePosition.distanceAlongRouteMeters)
            },
        )
    }

    private fun TrailRoute.navigationLegs(): List<TrailRouteNavigationLeg> {
        var cumulativeDistanceMeters = 0.0
        return TrailRouteDrawableSegmentMergeSijko
            .merge(segments)
            .flatMap { segment ->
                segment.points
                    .windowed(size = 2, step = 1)
                    .mapNotNull { (start, end) ->
                        val distanceMeters = TrailDistanceSijko.metersBetween(start, end)
                        if (distanceMeters < MINIMUM_LEG_METERS) {
                            null
                        } else {
                            TrailRouteNavigationLeg(
                                start = start,
                                end = end,
                                distanceMeters = distanceMeters,
                                cumulativeStartMeters = cumulativeDistanceMeters,
                                bearingDegrees = bearingDegrees(start, end),
                            ).also {
                                cumulativeDistanceMeters += distanceMeters
                            }
                        }
                    }
            }
    }

    /**
     * A loop starts and ends at the same place, so a rider who turns back early, or whose GPS
     * jitters at the start, also matches the far end of the route. Keep a position reachable by
     * continuous travel when it matches about as well, and accept a far jump only when nothing
     * continuous is comparably close (for example, after a GPS gap on a fresh part of the loop).
     * A far jump also needs the rider back on the route: off it, every part is about as far.
     */
    private fun continuousLoopPosition(
        point: MapPoint,
        legs: List<TrailRouteNavigationLeg>,
        minimumProgressMeters: Double,
    ): RoutePosition {
        val positions = routePositions(point, legs)
        val nearest = nearestRoutePosition(positions, minimumProgressMeters, BACKTRACK_TOLERANCE_METERS)
        val continuityLimitMeters = minimumProgressMeters + CONTINUITY_WINDOW_METERS
        if (nearest.distanceAlongRouteMeters <= continuityLimitMeters) {
            return nearest
        }
        if (nearest.distanceFromRouteMeters > OFF_ROUTE_METERS) {
            return heldPosition(point, legs, nearest, minimumProgressMeters) ?: nearest
        }
        val continuous = positions
            .filter { position -> position.distanceAlongRouteMeters <= continuityLimitMeters }
            .minByOrNull { position -> position.distanceFromRouteMeters }
            ?: return nearest
        return if (
            continuous.distanceFromRouteMeters <=
            nearest.distanceFromRouteMeters + CONTINUITY_MATCH_TOLERANCE_METERS
        ) {
            continuous
        } else {
            nearest
        }
    }

    /**
     * Where to hold an off-route rider: null when [nearest] is within normal reach of
     * [previousProgressMeters], otherwise the closest point at or just behind it. The hold never
     * moves forward, so repeated off-route fixes cannot creep progress toward a far projection.
     * Only progress is held: the distance from the route stays the physical distance to [nearest].
     */
    private fun heldPosition(
        point: MapPoint,
        legs: List<TrailRouteNavigationLeg>,
        nearest: RoutePosition,
        previousProgressMeters: Double,
    ): RoutePosition? {
        val earliestMeters = previousProgressMeters - BACKTRACK_TOLERANCE_METERS
        val latestMeters = previousProgressMeters + CONTINUITY_WINDOW_METERS
        if (nearest.distanceAlongRouteMeters in earliestMeters..latestMeters) {
            return null
        }
        return legs
            .mapNotNull { leg ->
                val fromMeters = max(earliestMeters, leg.cumulativeStartMeters)
                val toMeters = min(previousProgressMeters, leg.cumulativeStartMeters + leg.distanceMeters)
                if (fromMeters >= toMeters) {
                    return@mapNotNull null
                }
                val projection = TrailDistanceSijko.projectToSegment(
                    point = point,
                    segmentStart = leg.pointAt(fromMeters),
                    segmentEnd = leg.pointAt(toMeters),
                )
                RoutePosition(
                    point = projection.projectedPoint,
                    distanceAlongRouteMeters = fromMeters +
                        projection.distanceFromStartMeters.coerceIn(0.0, toMeters - fromMeters),
                    distanceFromRouteMeters = projection.distanceMeters,
                )
            }
            .minByOrNull { position -> position.distanceFromRouteMeters }
            .let { held -> held ?: RoutePosition(pointAtDistance(legs, previousProgressMeters), previousProgressMeters, 0.0) }
            .copy(distanceFromRouteMeters = nearest.distanceFromRouteMeters)
    }

    private fun TrailRouteNavigationLeg.pointAt(distanceAlongRouteMeters: Double): MapPoint {
        val ratio = ((distanceAlongRouteMeters - cumulativeStartMeters) / distanceMeters).coerceIn(0.0, 1.0)
        return MapPoint(
            latitude = start.latitude + (end.latitude - start.latitude) * ratio,
            longitude = start.longitude + (end.longitude - start.longitude) * ratio,
        )
    }

    private fun nearestRoutePosition(
        point: MapPoint,
        legs: List<TrailRouteNavigationLeg>,
        minimumProgressMeters: Double = 0.0,
        backtrackToleranceMeters: Double = BACKTRACK_TOLERANCE_METERS,
    ): RoutePosition {
        return nearestRoutePosition(routePositions(point, legs), minimumProgressMeters, backtrackToleranceMeters)
    }

    private fun routePositions(
        point: MapPoint,
        legs: List<TrailRouteNavigationLeg>,
    ): List<RoutePosition> {
        return legs.map { leg ->
            val projection = TrailDistanceSijko.projectToSegment(
                point = point,
                segmentStart = leg.start,
                segmentEnd = leg.end,
            )
            RoutePosition(
                point = projection.projectedPoint,
                distanceAlongRouteMeters = leg.cumulativeStartMeters +
                    projection.distanceFromStartMeters.coerceIn(0.0, leg.distanceMeters),
                distanceFromRouteMeters = projection.distanceMeters,
            )
        }
    }

    private fun nearestRoutePosition(
        positions: List<RoutePosition>,
        minimumProgressMeters: Double,
        backtrackToleranceMeters: Double,
    ): RoutePosition {
        val progressFloorMeters = (minimumProgressMeters - backtrackToleranceMeters)
            .coerceAtLeast(0.0)
        return positions
            .filter { position -> position.distanceAlongRouteMeters >= progressFloorMeters }
            .minByOrNull { position -> position.distanceFromRouteMeters }
            ?: positions.minBy { position -> position.distanceFromRouteMeters }
    }

    private fun nextInstructionPosition(
        instructions: List<TrailRouteInstruction>,
        legs: List<TrailRouteNavigationLeg>,
        distanceAlongRouteMeters: Double,
    ): InstructionPosition? {
        // Resolve instructions in route order so a junction visited twice maps each
        // instruction to its own occurrence instead of the first one.
        var previousInstructionMeters = 0.0
        var expectedInstructionMeters = 0.0
        return instructions
            .mapIndexed { index, instruction ->
                expectedInstructionMeters += instruction.distanceMeters
                val instructionMeters = nearestRoutePosition(
                    point = instruction.point,
                    legs = legs,
                    minimumProgressMeters = max(previousInstructionMeters, expectedInstructionMeters),
                    backtrackToleranceMeters = INSTRUCTION_ORDER_TOLERANCE_METERS,
                ).distanceAlongRouteMeters
                previousInstructionMeters = instructionMeters
                InstructionPosition(
                    index = index,
                    instruction = instruction,
                    distanceAlongRouteMeters = instructionMeters,
                )
            }
            .filter { position -> position.instruction.maneuver != TrailRouteInstructionManeuver.Start }
            .firstOrNull { position ->
                position.distanceAlongRouteMeters >= distanceAlongRouteMeters - INSTRUCTION_ADVANCE_TOLERANCE_METERS
            }
            ?: instructions.lastOrNull()?.let { instruction ->
                InstructionPosition(
                    index = instructions.lastIndex,
                    instruction = instruction,
                    distanceAlongRouteMeters = legs.last().cumulativeStartMeters + legs.last().distanceMeters,
                )
            }
    }

    private fun pointAtDistance(
        legs: List<TrailRouteNavigationLeg>,
        distanceAlongRouteMeters: Double,
    ): MapPoint {
        val leg = legAtDistance(legs, distanceAlongRouteMeters)
        val legDistanceMeters = (distanceAlongRouteMeters - leg.cumulativeStartMeters)
            .coerceIn(0.0, leg.distanceMeters)
        val ratio = legDistanceMeters / leg.distanceMeters
        return MapPoint(
            latitude = leg.start.latitude + (leg.end.latitude - leg.start.latitude) * ratio,
            longitude = leg.start.longitude + (leg.end.longitude - leg.start.longitude) * ratio,
        )
    }

    private fun legAtDistance(
        legs: List<TrailRouteNavigationLeg>,
        distanceAlongRouteMeters: Double,
    ): TrailRouteNavigationLeg {
        return legs.firstOrNull { leg ->
            distanceAlongRouteMeters <= leg.cumulativeStartMeters + leg.distanceMeters
        } ?: legs.last()
    }

    private fun bearingDegrees(
        start: MapPoint,
        end: MapPoint,
    ): Double {
        val startLatitude = start.latitude.toRadians()
        val endLatitude = end.latitude.toRadians()
        val longitudeDelta = (end.longitude - start.longitude).toRadians()
        val x = sin(longitudeDelta) * cos(endLatitude)
        val y = cos(startLatitude) * sin(endLatitude) -
            sin(startLatitude) * cos(endLatitude) * cos(longitudeDelta)
        return (atan2(x, y).toDegrees() + FULL_CIRCLE_DEGREES) % FULL_CIRCLE_DEGREES
    }

    private fun Double.toRadians(): Double = this * PI / HALF_CIRCLE_DEGREES

    private fun Double.toDegrees(): Double = this * HALF_CIRCLE_DEGREES / PI

    private data class RoutePosition(
        val point: MapPoint,
        val distanceAlongRouteMeters: Double,
        val distanceFromRouteMeters: Double,
    )

    private data class InstructionPosition(
        val index: Int,
        val instruction: TrailRouteInstruction,
        val distanceAlongRouteMeters: Double,
    )

    private const val LOOK_AHEAD_METERS = 45.0
    private const val INSTRUCTION_ADVANCE_TOLERANCE_METERS = 5.0
    private const val MINIMUM_LEG_METERS = 0.1
    private const val BACKTRACK_TOLERANCE_METERS = 60.0
    private const val CONTINUITY_WINDOW_METERS = 300.0
    private const val CONTINUITY_MATCH_TOLERANCE_METERS = 30.0
    private const val INSTRUCTION_ORDER_TOLERANCE_METERS = 1.0
    private const val HALF_CIRCLE_DEGREES = 180.0
    private const val FULL_CIRCLE_DEGREES = 360.0
}
