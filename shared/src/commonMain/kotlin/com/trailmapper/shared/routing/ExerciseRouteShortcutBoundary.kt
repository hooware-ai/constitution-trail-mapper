/**
 * Job: Carry one sampled route boundary that can anchor an ordinary-road exercise shortcut.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

internal data class ExerciseRouteShortcutBoundary(
    val edgeIndex: Int,
    val distanceAlongRouteMeters: Double,
    val point: MapPoint,
)
