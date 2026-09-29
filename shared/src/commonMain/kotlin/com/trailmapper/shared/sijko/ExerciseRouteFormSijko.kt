/**
 * Job: Judge the exercise planner's inputs so the form can guide the rider before a search is tried.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.routing.ExerciseRouteTargetSijko
import kotlin.math.abs
import kotlin.math.round

object ExerciseRouteFormSijko {
    /** Common loop lengths offered as one-tap choices; anything else is typed in. */
    val PRESET_MILES: List<Int> = listOf(3, 5, 8, 10)

    const val DISTANCE_RANGE_TEXT = "0.5 to 100"

    fun parsedMiles(text: String): Double? = text.trim().toDoubleOrNull()?.takeIf { miles -> miles.isFinite() }

    fun isDistanceValid(text: String): Boolean {
        val miles = parsedMiles(text) ?: return false
        return ExerciseRouteTargetSijko.isValid(miles * METERS_PER_MILE)
    }

    /** Only a distance that was typed and is wrong gets an error; an empty field is just unfinished. */
    fun distanceError(text: String): String? = when {
        text.isBlank() -> null
        isDistanceValid(text) -> null
        else -> "Enter a distance from $DISTANCE_RANGE_TEXT mi."
    }

    fun isPresetSelected(
        text: String,
        preset: Int,
    ): Boolean = parsedMiles(text) == preset.toDouble()

    fun canCreate(
        startAddress: String,
        startPoint: MapPoint?,
        milesText: String,
        isBusy: Boolean,
    ): Boolean = !isBusy && startAddress.isNotBlank() && startPoint != null && isDistanceValid(milesText)

    /** Why Create is unavailable, in the order the rider would fix it; null once the form is ready. */
    fun guidance(
        startAddress: String,
        startPoint: MapPoint?,
        isResolvingStart: Boolean,
        milesText: String,
    ): String? = when {
        startAddress.isBlank() -> "Add a start to create a loop."
        startPoint == null && isResolvingStart -> null
        startPoint == null -> "Choose a suggestion, your current location, or a point on the map so the loop starts where you mean."
        milesText.isBlank() -> "Add a distance to create a loop."
        else -> null
    }

    /** For example "Requested 5 mi · Found 5.01 mi", so a near miss is plain rather than hidden. */
    fun comparisonText(
        requestedMiles: Double,
        foundMeters: Double,
    ): String = "Requested ${milesLabel(requestedMiles)} mi · Found ${milesLabel(foundMeters / METERS_PER_MILE)} mi"

    private fun milesLabel(miles: Double): String {
        val oneDecimal = round(miles * 10) / 10
        return if (abs(oneDecimal - miles) < 0.005) {
            if (oneDecimal == round(oneDecimal)) round(oneDecimal).toInt().toString() else oneDecimal.toString()
        } else {
            (round(miles * 100) / 100).toString()
        }
    }

    private const val METERS_PER_MILE = 1609.344
}
