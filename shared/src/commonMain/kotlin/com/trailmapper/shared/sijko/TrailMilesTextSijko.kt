/**
 * Job: Write a route distance as miles to one decimal place, the way every list row shows it.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.math.roundToInt

object TrailMilesTextSijko {
    private const val METERS_PER_MILE = 1609.344

    /** For example "2.5" for 4,023 meters; the caller adds " mi". */
    fun milesText(meters: Double): String {
        val tenths = (meters / METERS_PER_MILE * 10).roundToInt()
        return "${tenths / 10}.${tenths % 10}"
    }
}
