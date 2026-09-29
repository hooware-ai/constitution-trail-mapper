/**
 * Job: Verify off-route confirmation needs sustained credible evidence and ignores GPS artifacts.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.routing.TrailRouteDeviationStatus.ConfirmedOffRoute
import com.trailmapper.shared.routing.TrailRouteDeviationStatus.OnRoute
import com.trailmapper.shared.routing.TrailRouteDeviationStatus.PossiblyOffRoute
import com.trailmapper.shared.routing.TrailRouteDeviationStatus.UncertainPosition
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailRouteDeviationSijkoTest {
    @Test
    fun aSustainedMovingDepartureIsConfirmed() {
        // Riding away from the route at about 5 m/s, a fix every 3 s.
        val statuses = ride((0..6).map { step -> Reading(seconds = step * 3, offMeters = 70.0 + step * 15) })

        assertEquals(
            listOf(PossiblyOffRoute, PossiblyOffRoute, PossiblyOffRoute, PossiblyOffRoute, PossiblyOffRoute, ConfirmedOffRoute, ConfirmedOffRoute),
            statuses,
        )
    }

    @Test
    fun aSingleGpsJumpIsNotADeparture() {
        val statuses = ride(
            Reading(0, 5.0),
            Reading(3, 8.0),
            Reading(6, 2_700.0),
            Reading(9, 6.0),
            Reading(12, 4.0),
        )

        assertTrue(ConfirmedOffRoute !in statuses)
        assertEquals(OnRoute, statuses.last())
    }

    @Test
    fun coarseFixesAreUncertainAndNeverConfirm() {
        val statuses = ride((0..10).map { step -> Reading(step * 3, offMeters = 150.0, accuracyMeters = 60.0) })

        assertTrue(statuses.all { it == UncertainPosition }, "$statuses")
    }

    @Test
    fun aFixWithNoAccuracyIsUncertain() {
        assertEquals(UncertainPosition, ride(Reading(0, 150.0, accuracyMeters = null)).single())
    }

    @Test
    fun aStaleFixIsUncertain() {
        val state = TrailRouteDeviationSijko.next(
            previous = TrailRouteDeviationState(),
            fix = TrailRouteNavigationFix(start, accuracyMeters = 5.0, timeEpochMillis = 0L),
            distanceFromRouteMeters = 150.0,
            nowEpochMillis = 20_000L,
        )

        assertEquals(UncertainPosition, state.status)
    }

    @Test
    fun aFixThatArrivesLateIsUncertainAndNeverCounts() {
        // Off-route fixes delivered a minute after they were taken are not current evidence.
        val statuses = ride((0..6).map { step -> Reading(step * 3, offMeters = 70.0 + step * 15, lateSeconds = 60) })

        assertTrue(statuses.all { it == UncertainPosition }, "$statuses")
    }

    @Test
    fun aFutureDatedFixIsUncertain() {
        assertEquals(UncertainPosition, ride(Reading(0, 150.0, lateSeconds = -5)).single())
    }

    @Test
    fun aGapInFixesRestartsTheEvidence() {
        // Two off-route fixes, a 20 s gap (tunnel, background), then two more: never three in a row.
        val statuses = ride(
            Reading(0, 80.0, travelMeters = 0.0),
            Reading(10, 90.0, travelMeters = 50.0),
            Reading(30, 100.0, travelMeters = 150.0),
            Reading(40, 110.0, travelMeters = 200.0),
        )

        assertTrue(ConfirmedOffRoute !in statuses, "$statuses")
    }

    @Test
    fun aNearbyParallelTrailIsNotADeparture() {
        // Riding a parallel path 30-45 m away: within the off-route distance once GPS error is allowed.
        val statuses = ride((0..20).map { step -> Reading(step * 3, offMeters = if (step % 2 == 0) 30.0 else 45.0) })

        assertTrue(statuses.all { it == OnRoute }, "$statuses")
    }

    @Test
    fun aBriefDepartureAndReturnIsNotConfirmed() {
        val statuses = ride(
            Reading(0, 5.0),
            Reading(3, 70.0),
            Reading(6, 80.0),
            Reading(9, 10.0),
            Reading(12, 5.0),
        )

        assertTrue(ConfirmedOffRoute !in statuses)
        assertEquals(OnRoute, statuses.last())
    }

    @Test
    fun standingStillOffTheRouteIsNotConfirmed() {
        // A stop at a shop 100 m off the route: accurate fixes, but no travel to show a departure.
        val statuses = ride((0..20).map { step -> Reading(step * 3, offMeters = 100.0, travelMeters = 0.0) })

        assertTrue(ConfirmedOffRoute !in statuses, "$statuses")
    }

    @Test
    fun leavingAConfirmedDepartureNeedsTwoFixesBackOnTheRoute() {
        val confirmed = (0..5).map { step -> Reading(step * 3, offMeters = 70.0 + step * 15) }
        val statuses = ride(confirmed + listOf(Reading(18, 10.0), Reading(21, 60.0), Reading(24, 10.0), Reading(27, 8.0)))

        assertEquals(listOf(ConfirmedOffRoute, ConfirmedOffRoute, ConfirmedOffRoute, ConfirmedOffRoute, OnRoute), statuses.takeLast(5))
    }

    @Test
    fun returnReadingsSeparatedByALongGapDoNotEndADeparture() {
        val confirmed = (0..5).map { step -> Reading(step * 3, offMeters = 70.0 + step * 15) }
        val statuses = ride(confirmed + listOf(Reading(18, 10.0), Reading(90, 10.0), Reading(93, 8.0)))

        // 72 s without a credible fix: the 90 s reading starts the return count over.
        assertEquals(listOf(ConfirmedOffRoute, ConfirmedOffRoute, OnRoute), statuses.takeLast(3))
    }

    @Test
    fun aCoarseOrStaleFixBetweenReturnReadingsBreaksTheirContinuity() {
        val confirmed = (0..5).map { step -> Reading(step * 3, offMeters = 70.0 + step * 15) }
        val coarse = ride(
            confirmed + listOf(Reading(18, 10.0), Reading(21, 10.0, accuracyMeters = 80.0), Reading(24, 10.0), Reading(27, 8.0)),
        )
        val stale = ride(
            confirmed + listOf(Reading(18, 10.0), Reading(21, 10.0, lateSeconds = 30), Reading(24, 10.0), Reading(27, 8.0)),
        )

        assertEquals(listOf(ConfirmedOffRoute, ConfirmedOffRoute, ConfirmedOffRoute, OnRoute), coarse.takeLast(4))
        assertEquals(listOf(ConfirmedOffRoute, ConfirmedOffRoute, ConfirmedOffRoute, OnRoute), stale.takeLast(4))
    }

    @Test
    fun aCoarseFixKeepsAConfirmedDeparture() {
        val confirmed = (0..5).map { step -> Reading(step * 3, offMeters = 70.0 + step * 15) }
        val statuses = ride(confirmed + Reading(18, 10.0, accuracyMeters = 80.0))

        assertEquals(ConfirmedOffRoute, statuses.last())
    }

    private data class Reading(
        val seconds: Int,
        val offMeters: Double,
        val accuracyMeters: Double? = 8.0,
        /** How far the rider has moved from the first fix; defaults to 5 m/s. */
        val travelMeters: Double = seconds * 5.0,
        /** How long after it was taken the fix is judged; negative means dated in the future. */
        val lateSeconds: Int = 0,
    )

    private fun ride(vararg readings: Reading): List<TrailRouteDeviationStatus> = ride(readings.toList())

    private fun ride(readings: List<Reading>): List<TrailRouteDeviationStatus> {
        var state = TrailRouteDeviationState()
        return readings.map { reading ->
            val point = MapPoint(start.latitude + reading.travelMeters / METERS_PER_DEGREE, start.longitude)
            state = TrailRouteDeviationSijko.next(
                previous = state,
                fix = TrailRouteNavigationFix(point, reading.accuracyMeters, reading.seconds * 1_000L),
                distanceFromRouteMeters = reading.offMeters,
                nowEpochMillis = (reading.seconds + reading.lateSeconds) * 1_000L,
            )
            state.status
        }
    }

    private val start = MapPoint(40.0, -89.0)

    private companion object {
        const val METERS_PER_DEGREE = 111_320.0
    }
}
