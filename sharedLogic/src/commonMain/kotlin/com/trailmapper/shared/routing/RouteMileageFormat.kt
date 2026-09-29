package com.trailmapper.shared.routing

import kotlin.math.round

/** Preserve native mileage text on JS, where Double.toString() omits the decimal for integers. */
internal fun formatRouteMiles(miles: Double): String {
    val rounded = round(miles * 100.0) / 100.0
    return if (rounded == rounded.toLong().toDouble()) "${rounded.toLong()}.0" else rounded.toString()
}
