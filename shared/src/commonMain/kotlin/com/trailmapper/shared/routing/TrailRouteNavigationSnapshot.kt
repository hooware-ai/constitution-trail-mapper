/**
 * Job: Carry active navigation progress and chase-camera inputs for one route position.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailRouteNavigationSnapshot(
    val snappedPoint: MapPoint,
    val cameraTarget: MapPoint,
    val bearingDegrees: Double,
    val distanceFromRouteMeters: Double,
    val distanceAlongRouteMeters: Double,
    val routeDistanceMeters: Double,
    val remainingDistanceMeters: Double,
    val nextInstruction: TrailRouteInstruction?,
    val nextInstructionIndex: Int,
    val distanceToNextInstructionMeters: Double?,
)
