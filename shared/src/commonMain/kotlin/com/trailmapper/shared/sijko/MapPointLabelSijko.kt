/**
 * Job: Format selected map coordinates for display in route endpoint fields.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.math.abs
import kotlin.math.roundToLong

object MapPointLabelSijko {
    fun labelFor(point: MapPoint): String {
        return "Map point ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}"
    }

    fun coordinateTextFor(point: MapPoint): String {
        return "${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}"
    }

    private fun Double.toFixed(decimalPlaces: Int): String {
        val scale = powerOfTen(decimalPlaces)
        val scaled = (abs(this) * scale).roundToLong()
        val whole = scaled / scale
        val fraction = (scaled % scale).toString().padStart(decimalPlaces, '0')
        val sign = if (this < 0.0 && scaled != 0L) "-" else ""
        return "$sign$whole.$fraction"
    }

    private fun powerOfTen(exponent: Int): Long {
        var value = 1L
        repeat(exponent) {
            value *= 10L
        }
        return value
    }
}
