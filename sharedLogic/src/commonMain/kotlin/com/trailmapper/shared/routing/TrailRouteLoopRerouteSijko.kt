/**
 * Job: Offer an off-route exercise rider a forward rejoin of the remaining loop, or a route back to the start.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.time.Clock

/**
 * An exercise loop is a workout, not a destination, so a departure is never answered with a fresh loop,
 * by rewinding completed progress, or by jumping to a later pass where the loop overlaps itself. The
 * rider chooses between rejoining the remaining loop ahead of their progress and returning to the start.
 */
object TrailRouteLoopRerouteSijko {
    /**
     * A route from [from] to the nearest reachable point ahead on the remaining loop, followed by the rest
     * of the loop from there. Candidate rejoin points lie ahead of [progressMeters] only; among them the
     * earliest is taken whose connector is not much longer than the shortest, so little of the loop is
     * skipped for a slightly shorter connector.
     */
    fun rejoin(
        features: List<TrailNetworkFeature>,
        route: TrailRoute,
        from: MapPoint,
        progressMeters: Double,
        accessGraph: TrailGraph?,
        cancellationCheckpoint: () -> Unit = {},
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
    ): TrailRouteRerouteOutcome {
        val shape = TrailRouteTraversalShapeSijko.shapeFor(route)
        val routeMeters = shape.pieces.lastOrNull()?.distancesAlongRouteMeters?.lastOrNull()
            ?: return TrailRouteRerouteOutcome.NoSafeRoute(emptyList())
        val layers = TrailRouteRerouteSijko.layersFor(route)
        val candidates = REJOIN_OFFSETS_METERS
            .map { offset -> progressMeters + offset }
            .filter { rejoinMeters -> rejoinMeters < routeMeters - MINIMUM_REMAINDER_METERS }
            .mapNotNull { rejoinMeters -> pointAt(shape, rejoinMeters)?.let { point -> rejoinMeters to point } }
        var blockingClosures = emptyList<TrailRouteClosure>()
        val connections = mutableListOf<Pair<Double, TrailRoute>>()
        var chosen: Pair<Double, TrailRoute>? = null
        // Each search takes about a second, so stop once the answer is settled: no connector is shorter
        // than the straight line to its rejoin point, so once the earliest connector found is within the
        // slack of every remaining candidate's straight line, searching those cannot change the choice.
        for ((index, candidate) in candidates.withIndex()) {
            cancellationCheckpoint()
            val (rejoinMeters, rejoinPoint) = candidate
            val outcome = TrailRouteCalculationSijko.findRouteOutcome(
                features = features,
                routeLayers = layers,
                startPoint = from,
                destinationPoint = rejoinPoint,
                accessGraph = accessGraph,
                cancellationCheckpoint = cancellationCheckpoint,
                nowEpochMillis = nowEpochMillis,
            )
            if (outcome.route == null && blockingClosures.isEmpty()) {
                blockingClosures = outcome.blockingClosures
            }
            outcome.route?.let { connector -> connections += rejoinMeters to connector }
            val lowerBound = (
                connections.map { (_, connector) -> connector.totalDistanceMeters } +
                    candidates.drop(index + 1).map { (_, point) -> TrailDistanceSijko.metersBetween(from, point) }
                ).minOrNull() ?: break
            chosen = connections.firstOrNull { (_, connector) ->
                connector.totalDistanceMeters <= lowerBound + CONNECTOR_SLACK_METERS
            }
            if (chosen != null) {
                break
            }
        }
        val (rejoinMeters, connector) = chosen ?: return TrailRouteRerouteOutcome.NoSafeRoute(blockingClosures)
        // The rest of the loop is cut from its own segments and traversal, which are measured without the
        // bridged gaps that navigation distance includes, so the rejoin distance is converted first.
        val rejoinGeometryMeters = TrailRouteDistanceBasisSijko.geometryMetersAt(route, rejoinMeters)
        val rejoinTraversalMeters = TrailRouteDistanceBasisSijko.traversalMetersAtGeometry(route.traversalEdges, rejoinGeometryMeters)
        return TrailRouteRerouteOutcome.Replacement(
            TrailRoute(
                segments = connector.segments + TrailRouteDistanceBasisSijko.segmentsFrom(route, rejoinGeometryMeters),
                totalDistanceMeters = connector.totalDistanceMeters +
                    (route.totalDistanceMeters - rejoinTraversalMeters).coerceAtLeast(0.0),
                ordinaryAccessDistanceMeters = connector.ordinaryAccessDistanceMeters,
                sharedRoadwayDistanceMeters = connector.sharedRoadwayDistanceMeters,
                totalCost = connector.totalCost,
                kind = TrailRouteKind.ExerciseLoop,
                requestedDistanceMeters = route.requestedDistanceMeters,
                // Only what is left to ride: history must not credit the stretch skipped by rejoining
                // ahead, and junction guidance needs only the connector's and the remainder's choice points.
                traversalEdges = connector.traversalEdges +
                    ExerciseRouteTraversalSijko.slice(route.traversalEdges, fromMeters = rejoinTraversalMeters),
                routeLayers = layers,
            ),
        )
    }

    /** A route from [from] back to the loop's start, ending the workout early. */
    fun returnToStart(
        features: List<TrailNetworkFeature>,
        route: TrailRoute,
        from: MapPoint,
        accessGraph: TrailGraph?,
        cancellationCheckpoint: () -> Unit = {},
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
    ): TrailRouteRerouteOutcome {
        // A loop finishes where it started. After a rejoin the route begins at the connector instead,
        // but every rejoin keeps the original finish, so the finish is the workout's start.
        val start = route.segments.lastOrNull()?.points?.lastOrNull()
            ?: return TrailRouteRerouteOutcome.NoSafeRoute(emptyList())
        val outcome = TrailRouteCalculationSijko.findRouteOutcome(
            features = features,
            routeLayers = TrailRouteRerouteSijko.layersFor(route),
            startPoint = from,
            destinationPoint = start,
            accessGraph = accessGraph,
            cancellationCheckpoint = cancellationCheckpoint,
            nowEpochMillis = nowEpochMillis,
        )
        // A plain navigation route: riding it home does not complete the workout.
        return outcome.route
            ?.let { home -> TrailRouteRerouteOutcome.Replacement(home.copy(kind = TrailRouteKind.Navigation)) }
            ?: TrailRouteRerouteOutcome.NoSafeRoute(outcome.blockingClosures)
    }

    private fun pointAt(shape: TrailRouteTraversalShape, meters: Double): MapPoint? {
        shape.pieces.forEach { piece ->
            val distances = piece.distancesAlongRouteMeters
            val index = distances.indexOfLast { it <= meters }
            if (index in 0 until distances.lastIndex && distances[index + 1] >= meters) {
                val points = piece.segment.points
                return interpolate(points[index], points[index + 1], distances[index], distances[index + 1], meters)
            }
        }
        return null
    }

    private fun interpolate(from: MapPoint, to: MapPoint, fromMeters: Double, toMeters: Double, atMeters: Double): MapPoint {
        val ratio = if (toMeters > fromMeters) (atMeters - fromMeters) / (toMeters - fromMeters) else 0.0
        return MapPoint(
            latitude = from.latitude + (to.latitude - from.latitude) * ratio,
            longitude = from.longitude + (to.longitude - from.longitude) * ratio,
        )
    }

    /** Rejoin points tried, ahead of the rider's progress. */
    private val REJOIN_OFFSETS_METERS = listOf(100.0, 300.0, 600.0, 1_000.0)
    private const val MINIMUM_REMAINDER_METERS = 100.0
    private const val CONNECTOR_SLACK_METERS = 200.0
}
