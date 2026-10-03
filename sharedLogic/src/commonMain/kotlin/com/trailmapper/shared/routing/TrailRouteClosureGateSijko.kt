/**
 * Job: Keep a route that rides through an active trail closure from starting, and plan it again around the closure.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.sijko.MapPoint
import kotlin.time.Clock

/** How recalculating a blocked route came out. */
sealed interface TrailRouteRecalculationOutcome {
    data class Replacement(val route: TrailRoute) : TrailRouteRecalculationOutcome

    /** No route avoids the closure; [blockingClosures] carry the official detour guidance. */
    data class NoSafeRoute(val blockingClosures: List<TrailRouteClosure>) : TrailRouteRecalculationOutcome

    /** Road data exists but failed to load; nothing was searched, and the rider can try again. */
    data object RoadDataFailed : TrailRouteRecalculationOutcome
}

object TrailRouteClosureGateSijko {
    /**
     * The advisories for active trail closures that [route] rides through. A route found today already
     * avoids them; one planned earlier, then reopened, may not. Road-work advisories inform but never block.
     */
    fun blockingAdvisories(
        route: TrailRoute,
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
        derived: List<TrailRouteDerivedClosureLeg> = emptyList(),
    ): List<TrailRouteAdvisory> {
        val activeClosureIds = TrailRouteClosureSijko.activeClosures(nowEpochMillis).mapTo(mutableSetOf()) { it.id }
        return TrailRouteAdvisorySijko.forRoute(route, nowEpochMillis, derived).filter { it.id in activeClosureIds }
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
     * distance it was asked for. A result that still rides through a closure is not offered. As in a
     * reroute, road data that failed to load stops the search; only data that does not exist for the area
     * lets it continue with estimated access.
     */
    fun recalculate(
        features: List<TrailNetworkFeature>,
        route: TrailRoute,
        access: TrailRouteRerouteAccess,
        completedSessions: List<CompletedExerciseSession> = emptyList(),
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
        derived: List<TrailRouteDerivedClosureLeg> = emptyList(),
        cancellationCheckpoint: () -> Unit = {},
    ): TrailRouteRecalculationOutcome {
        val accessFeatures = when (access) {
            is TrailRouteRerouteAccess.Roads -> access.features
            TrailRouteRerouteAccess.NotAvailable -> null
            TrailRouteRerouteAccess.LoadFailed -> return TrailRouteRecalculationOutcome.RoadDataFailed
        }
        val start = startOf(route) ?: return noRouteFor(route, nowEpochMillis, derived)
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
                is TrailRouteRerouteOutcome.NoSafeRoute -> return TrailRouteRecalculationOutcome.NoSafeRoute(outcome.blockingClosures)
            }
        }
        return replacement
            // Not a way around a closure: a route that travels it, or whose own geometry (an estimated hop included)
            // starts or ends inside a closed section.
            ?.takeIf { blockingAdvisories(it, nowEpochMillis, derived).isEmpty() }
            ?.takeIf { !TrailRouteAdvisorySijko.entersClosedSection(it, nowEpochMillis) }
            ?.let(TrailRouteRecalculationOutcome::Replacement)
            ?: noRouteFor(route, nowEpochMillis, derived)
    }

    private fun noRouteFor(
        route: TrailRoute,
        nowEpochMillis: Long,
        derived: List<TrailRouteDerivedClosureLeg>,
    ): TrailRouteRecalculationOutcome.NoSafeRoute {
        val blockingIds = blockingAdvisories(route, nowEpochMillis, derived).mapTo(mutableSetOf()) { it.id }.also { ids ->
            // A route that only starts or ends inside a closed section (an estimated hop is its sole geometry there) is
            // stopped by that closure too, so the rider is told which one.
            TrailRouteClosureSijko.activeClosures(nowEpochMillis)
                .filter { TrailRouteAdvisorySijko.entersClosedSection(route, it) }
                .forEach { ids += it.id }
        }
        return TrailRouteRecalculationOutcome.NoSafeRoute(
            TrailRouteClosureSijko.activeClosures(nowEpochMillis).filter { it.id in blockingIds },
        )
    }
}
