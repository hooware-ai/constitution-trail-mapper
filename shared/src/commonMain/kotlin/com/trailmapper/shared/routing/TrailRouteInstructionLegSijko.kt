/**
 * Job: Convert merged, navigable route polylines into semantic instruction legs.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

internal object TrailRouteInstructionLegSijko {
    fun legsFor(route: TrailRoute): List<TrailRouteInstructionLeg> {
        // Verified choice points recorded when the route was built; none for older saved routes.
        val choicePoints = route.traversalEdges.flatMap { it.junctionCoordinates }.toSet()
        // Same drawable basis as navigation and TrailRouteTraversalShapeSijko, including its short joins
        // between same-style segments; unrouted estimated access stays separate and is dropped below.
        val pieces = TrailRouteDrawableSegmentMergeSijko
            .merge(route.segments)
            .filterNot { segment ->
                segment.type == TrailRouteSegmentType.Access && !segment.isRouted
            }
            .flatMap { segment -> segment.legPieces(choicePoints) }
        val legs = mutableListOf<TrailRouteInstructionLeg>()
        var pendingReversal = false
        var pendingJunctionTurn = false
        var previousPoints: List<MapPoint>? = null
        pieces.forEach { piece ->
            // A U-turn exactly at a segment boundary: the vertex before and after the join match.
            val reversesAtJoin = previousPoints?.let { previous ->
                previous.size >= 2 && piece.points.size >= 2 && previous.last() == piece.points.first() &&
                    previous[previous.size - 2] == piece.points[1]
            } == true
            // A recorded choice point can also sit where two differently styled pieces meet.
            val turnsAtJoin = previousPoints?.let { previous -> turnsAtRecordedJunction(previous, piece.points, choicePoints) } == true
            pendingReversal = pendingReversal || piece.startsWithReversal || reversesAtJoin
            pendingJunctionTurn = pendingJunctionTurn || piece.startsAtJunctionTurn || turnsAtJoin
            previousPoints = piece.points
            val leg = piece.segment.copy(points = piece.points).toInstructionLeg() ?: return@forEach
            // A dropped zero-length piece passes its reversal or junction turn on to the next real leg.
            legs += leg.copy(startsWithReversal = pendingReversal, startsAtJunctionTurn = pendingJunctionTurn && !pendingReversal)
            pendingReversal = false
            pendingJunctionTurn = false
        }
        return legs
    }

    private fun TrailRouteSegment.legPieces(choicePoints: Set<String>): List<LegPiece> {
        // Collapse near-duplicate vertices first, so a U-turn around a degenerate stub is still one U-turn.
        val cleanPoints = mutableListOf<MapPoint>()
        points.forEach { point ->
            val last = cleanPoints.lastOrNull()
            if (last == null || TrailDistanceSijko.metersBetween(last, point) >= MINIMUM_LEG_METERS) {
                cleanPoints += point
            }
        }
        return TrailRouteTraversalShapeSijko.splitAtReversals(cleanPoints).flatMapIndexed { reversalIndex, piece ->
            splitAtJunctionTurns(piece, choicePoints).mapIndexed { junctionIndex, points ->
                LegPiece(
                    segment = this,
                    points = points,
                    startsWithReversal = reversalIndex > 0 && junctionIndex == 0,
                    startsAtJunctionTurn = junctionIndex > 0,
                )
            }
        }
    }

    private fun turnsAtRecordedJunction(previous: List<MapPoint>, next: List<MapPoint>, choicePoints: Set<String>): Boolean {
        if (choicePoints.isEmpty() || previous.size < 2 || next.size < 2 || previous.last() != next.first() ||
            ExerciseRouteTraversalSijko.coordinateOf(next.first()) !in choicePoints
        ) {
            return false
        }
        return isStandardTurn(previous[previous.size - 2], previous.last(), next[1])
    }

    private fun isStandardTurn(before: MapPoint, at: MapPoint, after: MapPoint): Boolean {
        val incoming = bearingDegrees(before, at)
        val outgoing = bearingDegrees(at, after)
        val delta = (outgoing - incoming + HALF_CIRCLE_DEGREES + FULL_CIRCLE_DEGREES) % FULL_CIRCLE_DEGREES -
            HALF_CIRCLE_DEGREES
        return abs(delta) >= JUNCTION_TURN_DEGREES
    }

    /** Splits at interior verified choice points where the route turns at least a standard turn. */
    private fun splitAtJunctionTurns(points: List<MapPoint>, choicePoints: Set<String>): List<List<MapPoint>> {
        if (choicePoints.isEmpty() || points.size < 3) {
            return listOf(points)
        }
        val pieces = mutableListOf<List<MapPoint>>()
        var start = 0
        for (index in 1 until points.lastIndex) {
            if (ExerciseRouteTraversalSijko.coordinateOf(points[index]) !in choicePoints) {
                continue
            }
            if (isStandardTurn(points[index - 1], points[index], points[index + 1])) {
                pieces += points.subList(start, index + 1)
                start = index
            }
        }
        pieces += points.subList(start, points.size)
        return pieces
    }

    private data class LegPiece(
        val segment: TrailRouteSegment,
        val points: List<MapPoint>,
        val startsWithReversal: Boolean,
        val startsAtJunctionTurn: Boolean,
    )

    private fun TrailRouteSegment.toInstructionLeg(): TrailRouteInstructionLeg? {
        val pointPairs = points
            .windowed(size = 2, step = 1)
            .mapNotNull { (start, end) ->
                val distanceMeters = TrailDistanceSijko.metersBetween(start, end)
                if (distanceMeters < MINIMUM_LEG_METERS) {
                    null
                } else {
                    PointPair(start, end, distanceMeters)
                }
            }
        val firstPair = pointPairs.firstOrNull() ?: return null
        val lastPair = pointPairs.last()

        return TrailRouteInstructionLeg(
            start = firstPair.start,
            end = lastPair.end,
            distanceMeters = pointPairs.sumOf { pair -> pair.distanceMeters },
            entryBearingDegrees = bearingDegrees(firstPair.start, firstPair.end),
            exitBearingDegrees = bearingDegrees(lastPair.start, lastPair.end),
            segmentType = type,
            routeRoles = routeRoles,
            displayStyle = displayStyle,
            name = TrailRouteNameSijko.normalized(name),
        )
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

    private data class PointPair(
        val start: MapPoint,
        val end: MapPoint,
        val distanceMeters: Double,
    )

    private const val MINIMUM_LEG_METERS = 0.1

    // A same-trail choice point gets its own turn only for a standard turn or sharper, not a gentle bend.
    private const val JUNCTION_TURN_DEGREES = 60.0
    private const val HALF_CIRCLE_DEGREES = 180.0
    private const val FULL_CIRCLE_DEGREES = 360.0
}
