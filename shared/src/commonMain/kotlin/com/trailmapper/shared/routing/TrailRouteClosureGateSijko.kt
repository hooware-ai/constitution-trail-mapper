/**
 * Job: Keep a route that rides through an active trail closure from starting, and plan it again around the closure.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.sijko.MapPoint
import kotlin.time.Clock

object TrailRouteClosureGateSijko {
    /**
     * The advisories for active trail closures that [route] rides through. A route found today already
     * avoids them; one planned earlier, then reopened, may not. Road-work advisories inform but never block.
     */
    fun blockingAdvisories(
        route: TrailRoute,
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
    ): List<TrailRouteAdvisory> {
        val activeClosureIds = TrailRouteClosureSijko.activeClosures(nowEpochMillis).mapTo(mutableSetOf()) { it.id }
        return TrailRouteAdvisorySijko.forRoute(route, nowEpochMillis).filter { it.id in activeClosureIds }
    }

    fun startOf(route: TrailRoute): MapPoint? = route.segments.firstOrNull()?.points?.firstOrNull()

    /** Where road data is needed to plan [route] again: its start, and a point-to-point route's destination. */
    fun accessEndpoints(route: TrailRoute): List<MapPoint> {
        return listOfNotNull(
            startOf(route),
            TrailRouteRerouteSijko.destinationOf(route).takeIf { route.kind != TrailRouteKind.ExerciseLoop },
        )
    }

    /**
     * Plans [route] again under today's rules: active closures excluded, its own layers, reviewed hazards
     * weighed. A point-to-point route keeps its start and destination; a loop keeps its start and the
     * distance it was asked for. A result that still rides through a closure is not offered.
     */
    fun recalculate(
        features: List<TrailNetworkFeature>,
        route: TrailRoute,
        accessFeatures: List<AccessNetworkFeature>?,
        completedSessions: List<CompletedExerciseSession> = emptyList(),
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
        cancellationCheckpoint: () -> Unit = {},
    ): TrailRouteRerouteOutcome {
        val start = startOf(route) ?: return noRouteFor(route, nowEpochMillis)
        val replacement = if (route.kind == TrailRouteKind.ExerciseLoop) {
            val targetMeters = route.requestedDistanceMeters ?: route.totalDistanceMeters
            val accessGraph = accessFeatures?.let { roads ->
                AccessGraphBuilderSijko.buildGraph(
                    features = ExerciseRouteAccessNetworkFilterSijko.nearbyFeatures(roads, start, targetMeters),
                    cancellationCheckpoint = cancellationCheckpoint,
                )
            }
            ExerciseRouteCalculationSijko.findRoute(
                features = features,
                routeLayers = TrailRouteRerouteSijko.layersFor(route),
                startPoint = start,
                targetDistanceMeters = targetMeters,
                completedSessions = completedSessions,
                accessGraph = accessGraph,
                nowEpochMillis = nowEpochMillis,
                cancellationCheckpoint = cancellationCheckpoint,
            )?.route
        } else {
            val accessGraph = accessFeatures?.let { roads ->
                AccessGraphBuilderSijko.buildGraph(roads, cancellationCheckpoint = cancellationCheckpoint)
            }
            when (val outcome = TrailRouteRerouteSijko.pointToPoint(features, route, start, accessGraph, cancellationCheckpoint, nowEpochMillis)) {
                is TrailRouteRerouteOutcome.Replacement -> outcome.route
                is TrailRouteRerouteOutcome.NoSafeRoute -> return outcome
            }
        }
        return replacement
            ?.takeIf { blockingAdvisories(it, nowEpochMillis).isEmpty() }
            ?.let(TrailRouteRerouteOutcome::Replacement)
            ?: noRouteFor(route, nowEpochMillis)
    }

    private fun noRouteFor(
        route: TrailRoute,
        nowEpochMillis: Long,
    ): TrailRouteRerouteOutcome.NoSafeRoute {
        val blockingIds = blockingAdvisories(route, nowEpochMillis).mapTo(mutableSetOf()) { it.id }
        return TrailRouteRerouteOutcome.NoSafeRoute(
            TrailRouteClosureSijko.activeClosures(nowEpochMillis).filter { it.id in blockingIds },
        )
    }
}
