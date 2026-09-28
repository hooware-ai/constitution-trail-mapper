/**
 * Job: Verify saved route categories keep legacy navigation routes separate from exercise loops.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import kotlin.test.Test
import kotlin.test.assertEquals

class SavedTrailRouteFilterSijkoTest {
    @Test
    fun separatesNavigationAndExerciseRoutesWithoutReordering() {
        val navigationOne = savedRoute("navigation-1", TrailRouteKind.Navigation)
        val exercise = savedRoute("exercise", TrailRouteKind.ExerciseLoop)
        val navigationTwo = savedRoute("navigation-2", TrailRouteKind.Navigation)
        val routes = listOf(navigationOne, exercise, navigationTwo)

        assertEquals(
            listOf(navigationOne, navigationTwo),
            SavedTrailRouteFilterSijko.navigationRoutes(routes),
        )
        assertEquals(
            listOf(exercise),
            SavedTrailRouteFilterSijko.exerciseRoutes(routes),
        )
    }

    private fun savedRoute(
        id: String,
        kind: TrailRouteKind,
    ): SavedTrailRoute {
        return SavedTrailRoute(
            id = id,
            title = id,
            summary = id,
            route = TrailRoute(
                totalDistanceMeters = 1_000.0,
                ordinaryAccessDistanceMeters = 0.0,
                totalCost = 1_000.0,
                kind = kind,
            ),
        )
    }
}
