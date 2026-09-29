/**
 * Job: Decide from a stream of location fixes whether the rider has credibly left the route.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

/** One location fix as the device reported it. */
data class TrailRouteNavigationFix(
    val point: MapPoint,
    /** Horizontal accuracy radius, or null when the provider gave none. */
    val accuracyMeters: Double?,
    val timeEpochMillis: Long,
)

enum class TrailRouteDeviationStatus {
    OnRoute,

    /** The latest fix is too coarse or too old to judge; nothing is concluded from it. */
    UncertainPosition,

    /** Credibly off the route, but not yet for long enough to act on. */
    PossiblyOffRoute,

    /** Sustained, credible departure: safe to start a reroute search. */
    ConfirmedOffRoute,
}

data class TrailRouteDeviationState(
    val status: TrailRouteDeviationStatus = TrailRouteDeviationStatus.OnRoute,
    /** Credible off-route fixes in the current streak: time and place of the first, and how many. */
    val streakStartMillis: Long? = null,
    val streakStartPoint: MapPoint? = null,
    val streakFixCount: Int = 0,
    /** Consecutive credible on-route fixes while confirmed off route, for leaving that state. */
    val returnFixCount: Int = 0,
    val lastCredibleFixMillis: Long? = null,
) {
    /** True while a departure is confirmed; a caller starts one reroute when this turns true. */
    val isConfirmed: Boolean get() = status == TrailRouteDeviationStatus.ConfirmedOffRoute
}

/**
 * A single projected position more than 50 m off the route is not a reason to reroute: GPS jumps,
 * coarse fixes, gaps and brief departures all produce one. A departure is confirmed only by several
 * accurate, fresh fixes that stay off the route (after allowing for their error) over time and
 * distance, and it is left only after consecutive fixes back on it. The distance used is the
 * physical distance to the nearest part of the route, so overlapping loop legs and nearby parallel
 * trails within the off-route distance never count.
 */
object TrailRouteDeviationSijko {
    fun next(
        previous: TrailRouteDeviationState,
        fix: TrailRouteNavigationFix,
        distanceFromRouteMeters: Double,
        /** When the fix is being judged, from the device clock, so a late fix is not taken as current. */
        nowEpochMillis: Long,
    ): TrailRouteDeviationState {
        val accuracy = fix.accuracyMeters
        if (accuracy == null || !isCredible(fix, nowEpochMillis)) {
            // Keep a confirmed departure, but learn nothing from this fix, and let it break any run of
            // return readings: a return must be shown by consecutive credible fixes.
            return if (previous.isConfirmed) {
                previous.copy(returnFixCount = 0)
            } else {
                previous.copy(status = TrailRouteDeviationStatus.UncertainPosition)
            }
        }
        // After a gap in credible fixes, a streak can no longer be called continuous.
        val afterGap = previous.lastCredibleFixMillis
            ?.let { last -> fix.timeEpochMillis - last > MAXIMUM_FIX_GAP_MILLIS } == true
        val current = when {
            !afterGap -> previous
            // A departure stays confirmed across a gap, but return readings must start over.
            previous.isConfirmed -> previous.copy(returnFixCount = 0)
            else -> previous.copy(streakStartMillis = null, streakStartPoint = null, streakFixCount = 0)
        }.copy(lastCredibleFixMillis = fix.timeEpochMillis)

        val clearlyOff = distanceFromRouteMeters - accuracy > TrailRouteNavigationSnapshotSijko.OFF_ROUTE_METERS
        val clearlyOn = distanceFromRouteMeters <= ON_ROUTE_METERS

        if (current.isConfirmed) {
            if (!clearlyOn) {
                return current.copy(returnFixCount = 0)
            }
            val returns = current.returnFixCount + 1
            return if (returns >= RETURN_FIX_COUNT) {
                TrailRouteDeviationState(lastCredibleFixMillis = fix.timeEpochMillis)
            } else {
                current.copy(returnFixCount = returns)
            }
        }
        if (clearlyOn) {
            return TrailRouteDeviationState(lastCredibleFixMillis = fix.timeEpochMillis)
        }
        if (!clearlyOff) {
            // Near the edge of the route: neither evidence of a departure nor of a return.
            return current.copy(
                status = if (current.streakFixCount > 0) {
                    TrailRouteDeviationStatus.PossiblyOffRoute
                } else {
                    TrailRouteDeviationStatus.OnRoute
                },
            )
        }
        val streakStartMillis = current.streakStartMillis ?: fix.timeEpochMillis
        val streakStartPoint = current.streakStartPoint ?: fix.point
        val streakFixCount = current.streakFixCount + 1
        val confirmed = streakFixCount >= CONFIRMATION_FIX_COUNT &&
            fix.timeEpochMillis - streakStartMillis >= CONFIRMATION_MILLIS &&
            TrailDistanceSijko.metersBetween(streakStartPoint, fix.point) >= CONFIRMATION_TRAVEL_METERS
        return current.copy(
            status = if (confirmed) {
                TrailRouteDeviationStatus.ConfirmedOffRoute
            } else {
                TrailRouteDeviationStatus.PossiblyOffRoute
            },
            streakStartMillis = streakStartMillis,
            streakStartPoint = streakStartPoint,
            streakFixCount = streakFixCount,
            returnFixCount = 0,
        )
    }

    /** Whether [fix] is accurate and current enough to judge the rider's position from, as of [nowEpochMillis]. */
    fun isCredible(fix: TrailRouteNavigationFix, nowEpochMillis: Long): Boolean {
        val accuracy = fix.accuracyMeters ?: return false
        return accuracy <= MAXIMUM_ACCURACY_METERS &&
            nowEpochMillis - fix.timeEpochMillis in 0..MAXIMUM_FIX_AGE_MILLIS
    }

    /** Coarser fixes (for example network or approximate location) cannot place the rider on a trail. */
    private const val MAXIMUM_ACCURACY_METERS = 25.0
    private const val MAXIMUM_FIX_AGE_MILLIS = 10_000L
    private const val MAXIMUM_FIX_GAP_MILLIS = 15_000L

    /** Within this of the route counts as back on it; between this and the off-route distance is neither. */
    private const val ON_ROUTE_METERS = 35.0
    private const val CONFIRMATION_FIX_COUNT = 3
    private const val CONFIRMATION_MILLIS = 15_000L
    private const val CONFIRMATION_TRAVEL_METERS = 25.0
    private const val RETURN_FIX_COUNT = 2
}
