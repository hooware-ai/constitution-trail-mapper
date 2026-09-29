/**
 * Job: Decide when active exercise navigation has departed and genuinely completed its loop.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max

object ExerciseRouteCompletionSijko {
    fun hasDeparted(
        route: TrailRoute,
        snapshot: TrailRouteNavigationSnapshot?,
        previouslyDeparted: Boolean,
    ): Boolean {
        if (previouslyDeparted) {
            return true
        }
        if (route.kind != TrailRouteKind.ExerciseLoop || snapshot == null) {
            return false
        }
        val departureDistanceMeters = max(
            MINIMUM_DEPARTURE_METERS,
            snapshot.routeDistanceMeters * DEPARTURE_FRACTION,
        )
        return snapshot.distanceAlongRouteMeters >= departureDistanceMeters
    }

    /**
     * Credits only continuous forward progress past [previousMaximumProgressMeters]. A jump
     * (an early return matched to the loop's end, a reversed ride, or a GPS gap) earns nothing,
     * so completion needs evidence of travel through the planned route.
     */
    fun verifiedProgressMeters(
        previousVerifiedMeters: Double,
        previousMaximumProgressMeters: Double,
        snapshot: TrailRouteNavigationSnapshot?,
    ): Double {
        val stepMeters = (snapshot ?: return previousVerifiedMeters).distanceAlongRouteMeters -
            previousMaximumProgressMeters
        return if (stepMeters > 0.0 && stepMeters <= MAXIMUM_VERIFIED_STEP_METERS) {
            previousVerifiedMeters + stepMeters
        } else {
            previousVerifiedMeters
        }
    }

    fun shouldComplete(
        route: TrailRoute,
        snapshot: TrailRouteNavigationSnapshot?,
        hasDeparted: Boolean,
        alreadyCompleted: Boolean,
        verifiedProgressMeters: Double,
    ): Boolean {
        if (route.kind != TrailRouteKind.ExerciseLoop ||
            snapshot == null ||
            !hasDeparted ||
            alreadyCompleted ||
            verifiedProgressMeters < snapshot.routeDistanceMeters * MINIMUM_VERIFIED_FRACTION
        ) {
            return false
        }
        val finishWindowMeters = max(
            MINIMUM_FINISH_PROGRESS_METERS,
            snapshot.routeDistanceMeters * FINISH_PROGRESS_FRACTION,
        )
        return snapshot.remainingDistanceMeters <= finishWindowMeters &&
            snapshot.distanceFromRouteMeters <= MAXIMUM_FINISH_OFFSET_METERS
    }

    private const val MINIMUM_DEPARTURE_METERS = 100.0
    private const val DEPARTURE_FRACTION = 0.05
    private const val MINIMUM_FINISH_PROGRESS_METERS = 45.0
    private const val FINISH_PROGRESS_FRACTION = 0.015
    private const val MAXIMUM_FINISH_OFFSET_METERS = 40.0
    private const val MAXIMUM_VERIFIED_STEP_METERS = 300.0
    private const val MINIMUM_VERIFIED_FRACTION = 0.75
}
