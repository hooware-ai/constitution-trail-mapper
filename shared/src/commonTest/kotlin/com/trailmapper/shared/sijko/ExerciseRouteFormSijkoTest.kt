/**
 * Job: Verify the exercise form's validation, guidance and requested-versus-found wording.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ExerciseRouteFormSijkoTest {
    private val point = MapPoint(40.5, -88.9)

    @Test
    fun distancesWithinTheSearchRangeAreValidAndOthersAreNot() {
        assertTrue(ExerciseRouteFormSijko.isDistanceValid("5"))
        assertTrue(ExerciseRouteFormSijko.isDistanceValid(" 0.5 "))
        assertTrue(ExerciseRouteFormSijko.isDistanceValid("100"))
        assertFalse(ExerciseRouteFormSijko.isDistanceValid("0.4"))
        assertFalse(ExerciseRouteFormSijko.isDistanceValid("101"))
        assertFalse(ExerciseRouteFormSijko.isDistanceValid("abc"))
        assertFalse(ExerciseRouteFormSijko.isDistanceValid(""))
        assertFalse(ExerciseRouteFormSijko.isDistanceValid("NaN"))
    }

    @Test
    fun onlyATypedWrongDistanceGetsAnError() {
        assertNull(ExerciseRouteFormSijko.distanceError(""))
        assertNull(ExerciseRouteFormSijko.distanceError("5"))
        assertEquals("Enter a distance from 0.5 to 100 mi.", ExerciseRouteFormSijko.distanceError("500"))
        assertEquals("Enter a distance from 0.5 to 100 mi.", ExerciseRouteFormSijko.distanceError("five"))
    }

    @Test
    fun presetsMatchByValueSoTypingTheSameNumberSelectsThem() {
        assertTrue(ExerciseRouteFormSijko.isPresetSelected("5", 5))
        assertTrue(ExerciseRouteFormSijko.isPresetSelected("5.0", 5))
        assertFalse(ExerciseRouteFormSijko.isPresetSelected("5.5", 5))
        assertFalse(ExerciseRouteFormSijko.isPresetSelected("", 5))
        assertEquals(listOf(3, 5, 8, 10), ExerciseRouteFormSijko.PRESET_MILES)
    }

    @Test
    fun createNeedsAResolvedStartAValidDistanceAndNothingPending() {
        assertTrue(ExerciseRouteFormSijko.canCreate("Home", point, "5", isBusy = false))
        assertFalse(ExerciseRouteFormSijko.canCreate("Home", point, "5", isBusy = true))
        assertFalse(ExerciseRouteFormSijko.canCreate("Home", null, "5", isBusy = false))
        assertFalse(ExerciseRouteFormSijko.canCreate("", point, "5", isBusy = false))
        assertFalse(ExerciseRouteFormSijko.canCreate("Home", point, "0", isBusy = false))
    }

    @Test
    fun guidanceNamesTheNextThingToFixAndClearsWhenReady() {
        assertEquals("Add a start to create a loop.", ExerciseRouteFormSijko.guidance("", null, ""))
        // A typed but unresolved start is explained beside its field, not repeated here.
        assertNull(ExerciseRouteFormSijko.guidance("Hershey", null, "5"))
        assertEquals("Add a distance to create a loop.", ExerciseRouteFormSijko.guidance("Home", point, ""))
        assertNull(ExerciseRouteFormSijko.guidance("Home", point, "5"))
        assertNull(ExerciseRouteFormSijko.guidance("Home", point, "500"))
    }

    @Test
    fun comparisonShowsARealDifferencePlainly() {
        assertEquals("Requested 5 mi · Found 5.01 mi", ExerciseRouteFormSijko.comparisonText(5.0, 8_064.0))
        assertEquals("Requested 5 mi · Found 5 mi", ExerciseRouteFormSijko.comparisonText(5.0, 8_046.72))
        assertEquals("Requested 2.5 mi · Found 3.4 mi", ExerciseRouteFormSijko.comparisonText(2.5, 5_472.7))
    }
}
