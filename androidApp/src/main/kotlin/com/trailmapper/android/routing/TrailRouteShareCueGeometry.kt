/**
 * Job: Place second-pass offsets and direction chevrons along a route drawn in image pixels.
 *
 */
package com.trailmapper.android.routing

import kotlin.math.atan2
import kotlin.math.hypot

internal data class SharePixel(val x: Float, val y: Float)

internal data class ShareChevron(val x: Float, val y: Float, val angleDegrees: Float)

internal object TrailRouteShareCueGeometry {
    /**
     * Shifts a pixel polyline sideways by [pixels], to the right of its direction of travel. Image y grows
     * downward, so the right-hand normal of a travel direction (dx, dy) is (-dy, dx).
     */
    fun offsetToTheRight(points: List<SharePixel>, pixels: Float): List<SharePixel> {
        if (points.size < 2) {
            return points
        }
        return points.mapIndexed { index, point ->
            val before = points[maxOf(index - 1, 0)]
            val after = points[minOf(index + 1, points.lastIndex)]
            val dx = after.x - before.x
            val dy = after.y - before.y
            val length = hypot(dx, dy)
            if (length == 0f) {
                point
            } else {
                SharePixel(point.x - dy / length * pixels, point.y + dx / length * pixels)
            }
        }
    }

    /** Chevrons every [spacingPixels] along the polyline, starting half a spacing in, each facing travel. */
    fun chevronsAlong(points: List<SharePixel>, spacingPixels: Float): List<ShareChevron> {
        val chevrons = mutableListOf<ShareChevron>()
        var nextAt = spacingPixels / 2f
        var travelled = 0f
        points.zipWithNext().forEach { (from, to) ->
            val dx = to.x - from.x
            val dy = to.y - from.y
            val length = hypot(dx, dy)
            if (length == 0f) {
                return@forEach
            }
            val angle = Math.toDegrees(atan2(dy, dx).toDouble()).toFloat()
            while (nextAt <= travelled + length) {
                val ratio = (nextAt - travelled) / length
                chevrons += ShareChevron(from.x + dx * ratio, from.y + dy * ratio, angle)
                nextAt += spacingPixels
            }
            travelled += length
        }
        return chevrons
    }
}
