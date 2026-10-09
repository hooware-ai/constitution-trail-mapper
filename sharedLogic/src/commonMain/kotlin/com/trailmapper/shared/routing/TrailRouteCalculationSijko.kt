/**
 * Job: Calculate a constrained trail route from raw route data and a route-layer selection.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerSelection
import kotlin.time.Clock

object TrailRouteCalculationSijko {
    fun findRoute(
        features: List<TrailNetworkFeature>,
        routeLayers: RouteLayerSelection,
        startPoint: MapPoint,
        destinationPoint: MapPoint,
        accessGraph: TrailGraph?,
        cancellationCheckpoint: () -> Unit = {},
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
        applyClosures: Boolean = true,
    ): TrailRoute? {
        cancellationCheckpoint()
        val enabledFeatures = TrailFeatureFilterSijko.enabledFeatures(
            features = features,
            selection = routeLayers,
        )
        val routableFeatures = if (applyClosures) {
            TrailRouteClosureSijko.openFeatures(enabledFeatures, nowEpochMillis).features
        } else {
            enabledFeatures
        }
        cancellationCheckpoint()
        val trailGraph = TrailGraphBuilderSijko.buildGraph(
            features = routableFeatures,
            cancellationCheckpoint = cancellationCheckpoint,
        )
        cancellationCheckpoint()
        val route = if (accessGraph == null) {
            TrailRouteFinderSijko.findRoute(
                graph = trailGraph,
                start = startPoint,
                destination = destinationPoint,
                cancellationCheckpoint = cancellationCheckpoint,
            )
        } else {
            TrailRouteWithAccessFinderSijko.findRoute(
                trailGraph = trailGraph,
                accessGraph = accessGraph,
                start = startPoint,
                destination = destinationPoint,
                cancellationCheckpoint = cancellationCheckpoint,
            )
        } ?: return null
        // Record verified choice points, as exercise loops do, so a turn at a real junction on the same
        // trail gets an instruction.
        return route.copy(
            routeLayers = routeLayers,
            traversalEdges = TrailRouteChoicePointSijko.annotate(
                edges = route.edges,
                traversal = ExerciseRouteTraversalSijko.traversalFor(route.edges),
                trailGraph = trailGraph,
                accessGraph = accessGraph,
            ),
        )
    }

    /** [findRoute], plus the active closures that blocked it when no route was found. */
    fun findRouteOutcome(
        features: List<TrailNetworkFeature>,
        routeLayers: RouteLayerSelection,
        startPoint: MapPoint,
        destinationPoint: MapPoint,
        accessGraph: TrailGraph?,
        cancellationCheckpoint: () -> Unit = {},
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
    ): TrailRouteSearchOutcome {
        val route = findRoute(features, routeLayers, startPoint, destinationPoint, accessGraph, cancellationCheckpoint, nowEpochMillis)
        val blocking = if (route == null) {
            closuresBlockingRoute(features, routeLayers, startPoint, destinationPoint, accessGraph, cancellationCheckpoint, nowEpochMillis)
        } else {
            emptyList()
        }
        return TrailRouteSearchOutcome(route = route, blockingClosures = blocking)
    }

    /**
     * After [findRoute] found nothing, returns the active closures that caused it: a route exists
     * only when those closed sections are allowed. Returns empty when the closure is not the reason.
     */
    fun closuresBlockingRoute(
        features: List<TrailNetworkFeature>,
        routeLayers: RouteLayerSelection,
        startPoint: MapPoint,
        destinationPoint: MapPoint,
        accessGraph: TrailGraph?,
        cancellationCheckpoint: () -> Unit = {},
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
    ): List<TrailRouteClosure> {
        val applied = TrailRouteClosureSijko.openFeatures(
            features = TrailFeatureFilterSijko.enabledFeatures(features, routeLayers),
            nowEpochMillis = nowEpochMillis,
        ).appliedClosures
        if (applied.isEmpty()) {
            return emptyList()
        }
        val routeThroughClosure = findRoute(
            features = features,
            routeLayers = routeLayers,
            startPoint = startPoint,
            destinationPoint = destinationPoint,
            accessGraph = accessGraph,
            cancellationCheckpoint = cancellationCheckpoint,
            nowEpochMillis = nowEpochMillis,
            applyClosures = false,
        )
        return if (routeThroughClosure != null) applied else emptyList()
    }
}
