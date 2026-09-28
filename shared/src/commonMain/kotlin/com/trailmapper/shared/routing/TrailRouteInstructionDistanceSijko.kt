/**
 * Job: Format instruction distances for compact turn-by-turn route rows.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.roundToInt

object TrailRouteInstructionDistanceSijko {
    fun labelFor(distanceMeters: Double): String {
        if (distanceMeters < NOW_THRESHOLD_METERS) {
            return "Now"
        }

        val feet = distanceMeters * FEET_PER_METER
        if (feet < FEET_DISPLAY_LIMIT) {
            return "${feet.roundToNearest(NEARBY_FEET_INCREMENT).toInt()} ft"
        }

        val miles = distanceMeters / METERS_PER_MILE
        val roundedMiles = (miles * MILE_DECIMAL_INCREMENT).roundToInt() / MILE_DECIMAL_INCREMENT
        return "${roundedMiles.toString().trimTrailingZero()} mi"
    }

    private fun Double.roundToNearest(increment: Double): Double {
        return (this / increment).roundToInt() * increment
    }

    private fun String.trimTrailingZero(): String {
        return if (endsWith(".0")) {
            dropLast(2)
        } else {
            this
        }
    }

    private const val NOW_THRESHOLD_METERS = 1.0
    private const val FEET_PER_METER = 3.28084
    private const val FEET_DISPLAY_LIMIT = 500.0
    private const val NEARBY_FEET_INCREMENT = 25.0
    private const val METERS_PER_MILE = 1609.344
    private const val MILE_DECIMAL_INCREMENT = 10.0
}
