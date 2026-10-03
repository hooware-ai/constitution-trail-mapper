/**
 * Job: Measure positions along, and distance across, one straight line, for judging route legs against a closure.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

/** A straight line as a frame: position along it from its first point, and distance across it, in meters. */
internal class TrailRouteSourceFrame(private val origin: MapPoint, end: MapPoint) {
    private val cosLatitude = kotlin.math.cos(origin.latitude * kotlin.math.PI / 180.0)
    val length: Double
    private val directionX: Double
    private val directionY: Double

    init {
        val lineX = x(end)
        val lineY = y(end)
        length = kotlin.math.hypot(lineX, lineY)
        directionX = if (length > 0.0) lineX / length else 0.0
        directionY = if (length > 0.0) lineY / length else 0.0
    }

    private fun x(point: MapPoint) = (point.longitude - origin.longitude) * cosLatitude * METERS_PER_DEGREE
    private fun y(point: MapPoint) = (point.latitude - origin.latitude) * METERS_PER_DEGREE

    fun along(point: MapPoint) = x(point) * directionX + y(point) * directionY
    fun across(point: MapPoint) = kotlin.math.abs(x(point) * directionY - y(point) * directionX)

    /** Cosine of the angle between the leg and the line; null for a leg with no length. */
    fun alignment(start: MapPoint, end: MapPoint): Double? {
        val legX = x(end) - x(start)
        val legY = y(end) - y(start)
        val legLength = kotlin.math.hypot(legX, legY)
        return if (legLength <= 0.0) null else kotlin.math.abs((legX * directionX + legY * directionY) / legLength)
    }

    companion object {
        const val METERS_PER_DEGREE = 111_194.93
    }
}
