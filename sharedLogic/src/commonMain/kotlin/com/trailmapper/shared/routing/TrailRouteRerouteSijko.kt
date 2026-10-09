/**
 * Job: Find a replacement route after a confirmed departure, and decide when to search for one.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.AccessNetworkLoadResult
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import com.trailmapper.shared.sijko.RouteLayerSelection
import kotlin.time.Clock

sealed interface TrailRouteRerouteOutcome {
    /** A safe route from the rider's position to the original destination. */
    data class Replacement(val route: TrailRoute) : TrailRouteRerouteOutcome

    /** No safe route from here; [blockingClosures] names any active closure that is the reason. */
    data class NoSafeRoute(val blockingClosures: List<TrailRouteClosure>) : TrailRouteRerouteOutcome
}

/** How road data for a reroute search came back. */
sealed interface TrailRouteRerouteAccess {
    data class Roads(val features: List<AccessNetworkFeature>) : TrailRouteRerouteAccess

    /** No road data exists for this area; planning also routes without it, labeling access as estimated. */
    data object NotAvailable : TrailRouteRerouteAccess

    /** Road data exists but failed to load: searching without it would quietly change how the route is built. */
    data object LoadFailed : TrailRouteRerouteAccess
}

/**
 * Which search, if any, is running. Starting or cancelling a search makes every earlier one stale, so a
 * cancelled search that finishes late can neither clear a newer search's progress nor adopt its result.
 */
data class TrailRouteRerouteSearch(
    val generation: Int = 0,
    val inProgress: Boolean = false,
) {
    fun started(): TrailRouteRerouteSearch = TrailRouteRerouteSearch(generation + 1, inProgress = true)

    fun cancelled(): TrailRouteRerouteSearch = TrailRouteRerouteSearch(generation + 1, inProgress = false)

    /** A search ending: only the current one clears the in-progress state. */
    fun finished(searchGeneration: Int): TrailRouteRerouteSearch =
        if (isCurrent(searchGeneration)) copy(inProgress = false) else this

    fun isCurrent(searchGeneration: Int): Boolean = searchGeneration == generation
}

/** Where and when the last search started, so searches are not repeated as the rider moves. */
data class TrailRouteRerouteAttempt(
    val point: MapPoint,
    val timeEpochMillis: Long,
)

object TrailRouteRerouteSijko {
    /**
     * The layers a replacement may use: those the route was planned with. A route saved before they
     * were recorded gets the defaults, with proposed trails only if it already rides one.
     */
    fun layersFor(route: TrailRoute): RouteLayerSelection {
        return route.routeLayers ?: RouteLayerDefaultsSijko.defaultSelection().copy(
            proposedTrails = route.segments.any { segment -> TrailNetworkRole.ProposedTrails in segment.routeRoles },
        )
    }

    fun destinationOf(route: TrailRoute): MapPoint? = route.segments.lastOrNull()?.points?.lastOrNull()

    /**
     * Searches from [from] to [route]'s destination with the same rules as planning: active closures
     * excluded, reviewed hazards weighed, proposed trails only if opted in, and estimated access kept
     * labeled. It never joins unmapped ground with a straight line; that is a no-route outcome.
     */
    fun pointToPoint(
        features: List<TrailNetworkFeature>,
        route: TrailRoute,
        from: MapPoint,
        accessGraph: TrailGraph?,
        cancellationCheckpoint: () -> Unit = {},
        nowEpochMillis: Long = Clock.System.now().toEpochMilliseconds(),
    ): TrailRouteRerouteOutcome {
        val destination = destinationOf(route) ?: return TrailRouteRerouteOutcome.NoSafeRoute(emptyList())
        val outcome = TrailRouteCalculationSijko.findRouteOutcome(
            features = features,
            routeLayers = layersFor(route),
            startPoint = from,
            destinationPoint = destination,
            accessGraph = accessGraph,
            cancellationCheckpoint = cancellationCheckpoint,
            nowEpochMillis = nowEpochMillis,
        )
        return outcome.route
            ?.let { replacement -> TrailRouteRerouteOutcome.Replacement(replacement.copy(kind = route.kind)) }
            ?: TrailRouteRerouteOutcome.NoSafeRoute(outcome.blockingClosures)
    }

    /**
     * Whether to start an automatic search now: only while a departure is confirmed and no search is
     * running, from a fix accurate and current enough to start a route from, and after an earlier attempt
     * only once the rider has moved on and some time has passed, so a rider who stays off the route is not
     * searched for on every fix. A departure stays confirmed through a coarse or stale fix, so the fix
     * itself is checked here.
     */
    fun shouldSearchAutomatically(
        deviation: TrailRouteDeviationState,
        fix: TrailRouteNavigationFix,
        lastAttempt: TrailRouteRerouteAttempt?,
        searchInProgress: Boolean,
        nowEpochMillis: Long,
    ): Boolean {
        if (!deviation.isConfirmed || searchInProgress || !TrailRouteDeviationSijko.isCredible(fix, nowEpochMillis)) {
            return false
        }
        val previous = lastAttempt ?: return true
        return fix.timeEpochMillis - previous.timeEpochMillis >= RETRY_MILLIS &&
            TrailDistanceSijko.metersBetween(previous.point, fix.point) >= RETRY_TRAVEL_METERS
    }

    /**
     * Whether a finished search may replace the route. It may not if navigation stopped or the route
     * changed meanwhile, nor, for an automatic search, if the rider has credibly returned to the route:
     * a slow search must not replace a route the rider is riding again. A search the rider asked for is
     * adopted even from on the route.
     */
    fun shouldAdopt(
        requestedByRider: Boolean,
        deviationNow: TrailRouteDeviationState,
        routeUnchanged: Boolean,
        navigationActive: Boolean,
    ): Boolean {
        if (!navigationActive || !routeUnchanged) {
            return false
        }
        return requestedByRider || deviationNow.status != TrailRouteDeviationStatus.OnRoute
    }

    fun accessFor(result: AccessNetworkLoadResult): TrailRouteRerouteAccess = when (result) {
        is AccessNetworkLoadResult.Success -> TrailRouteRerouteAccess.Roads(result.features)
        AccessNetworkLoadResult.Unavailable -> TrailRouteRerouteAccess.NotAvailable
        is AccessNetworkLoadResult.Error -> TrailRouteRerouteAccess.LoadFailed
    }

    private const val RETRY_MILLIS = 30_000L
    private const val RETRY_TRAVEL_METERS = 100.0
}
