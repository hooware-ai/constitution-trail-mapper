/**
 * Job: Format a distance-based exercise duration using the product's eight-mph planning pace.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max
import kotlin.math.roundToInt

object ExerciseRouteDurationSijko {
    fun formatFor(distanceMeters: Double): String {
        val minutes = max(1, (distanceMeters / MetersPerMile / MilesPerHour * MinutesPerHour).roundToInt())
        return if (minutes < MinutesPerHour) {
            "$minutes min"
        } else {
            "${minutes / MinutesPerHour} hr ${minutes % MinutesPerHour} min"
        }
    }

    private const val MetersPerMile = 1_609.344
    private const val MilesPerHour = 8.0
    private const val MinutesPerHour = 60
}
