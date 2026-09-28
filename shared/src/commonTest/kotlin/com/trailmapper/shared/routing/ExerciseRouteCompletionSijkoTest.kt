/**
 * Job: Verify exercise completion requires departure, verified travel, near-finish progress, and one-time recording.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ExerciseRouteCompletionSijkoTest {
    @Test
    fun openingAnExerciseRouteAtItsStartDoesNotCompleteIt() {
        val route = exerciseRoute()
        val snapshot = snapshot(progressMeters = 0.0, remainingMeters = 1_000.0)

        assertFalse(
            ExerciseRouteCompletionSijko.shouldComplete(
                route = route,
                snapshot = snapshot,
                hasDeparted = false,
                alreadyCompleted = false,
                verifiedProgressMeters = 0.0,
            ),
        )
    }

    @Test
    fun departureLatchesAfterMeaningfulForwardProgress() {
        val route = exerciseRoute()

        assertFalse(
            ExerciseRouteCompletionSijko.hasDeparted(
                route = route,
                snapshot = snapshot(progressMeters = 90.0, remainingMeters = 910.0),
                previouslyDeparted = false,
            ),
        )
        assertTrue(
            ExerciseRouteCompletionSijko.hasDeparted(
                route = route,
                snapshot = snapshot(progressMeters = 110.0, remainingMeters = 890.0),
                previouslyDeparted = false,
            ),
        )
        assertTrue(
            ExerciseRouteCompletionSijko.hasDeparted(
                route = route,
                snapshot = null,
                previouslyDeparted = true,
            ),
        )
    }

    @Test
    fun completedLoopMustBeNearTheRouteAndIsOnlyRecordedOnce() {
        val route = exerciseRoute()
        val finish = snapshot(progressMeters = 980.0, remainingMeters = 20.0)

        assertTrue(
            ExerciseRouteCompletionSijko.shouldComplete(
                route = route,
                snapshot = finish,
                hasDeparted = true,
                alreadyCompleted = false,
                verifiedProgressMeters = 980.0,
            ),
        )
        assertFalse(
            ExerciseRouteCompletionSijko.shouldComplete(
                route = route,
                snapshot = finish,
                hasDeparted = true,
                alreadyCompleted = true,
                verifiedProgressMeters = 980.0,
            ),
        )
        assertFalse(
            ExerciseRouteCompletionSijko.shouldComplete(
                route = route,
                snapshot = finish.copy(distanceFromRouteMeters = 60.0),
                hasDeparted = true,
                alreadyCompleted = false,
                verifiedProgressMeters = 980.0,
            ),
        )
    }

    @Test
    fun navigationRoutesNeverEnterExerciseCompletion() {
        val route = exerciseRoute().copy(kind = TrailRouteKind.Navigation)
        val finish = snapshot(progressMeters = 990.0, remainingMeters = 10.0)

        assertFalse(ExerciseRouteCompletionSijko.hasDeparted(route, finish, false))
        assertFalse(ExerciseRouteCompletionSijko.shouldComplete(route, finish, true, false, 990.0))
    }

    @Test
    fun completionRequiresMostOfTheLoopToBeVerifiedTravel() {
        val route = exerciseRoute()
        val finish = snapshot(progressMeters = 990.0, remainingMeters = 10.0)

        assertFalse(ExerciseRouteCompletionSijko.shouldComplete(route, finish, true, false, 740.0))
        assertTrue(ExerciseRouteCompletionSijko.shouldComplete(route, finish, true, false, 760.0))
    }

    @Test
    fun onlyContinuousForwardStepsCountAsVerifiedTravel() {
        fun verifiedAfter(progressMeters: Double): Double {
            return ExerciseRouteCompletionSijko.verifiedProgressMeters(
                previousVerifiedMeters = 100.0,
                previousMaximumProgressMeters = 400.0,
                snapshot = snapshot(progressMeters = progressMeters, remainingMeters = 1_000.0 - progressMeters),
            )
        }

        assertEquals(120.0, verifiedAfter(420.0), 1e-9)
        assertEquals(100.0, verifiedAfter(380.0))
        assertEquals(100.0, verifiedAfter(990.0))
        assertEquals(100.0, ExerciseRouteCompletionSijko.verifiedProgressMeters(100.0, 400.0, null))
    }

    private fun exerciseRoute(): TrailRoute {
        return TrailRoute(
            totalDistanceMeters = 1_000.0,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1_000.0,
            kind = TrailRouteKind.ExerciseLoop,
        )
    }

    private fun snapshot(
        progressMeters: Double,
        remainingMeters: Double,
    ): TrailRouteNavigationSnapshot {
        val point = MapPoint(latitude = 40.0, longitude = -89.0)
        return TrailRouteNavigationSnapshot(
            snappedPoint = point,
            cameraTarget = point,
            bearingDegrees = 0.0,
            distanceFromRouteMeters = 0.0,
            distanceAlongRouteMeters = progressMeters,
            routeDistanceMeters = 1_000.0,
            remainingDistanceMeters = remainingMeters,
            nextInstruction = null,
            nextInstructionIndex = -1,
            distanceToNextInstructionMeters = null,
        )
    }
}
