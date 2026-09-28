/**
 * Job: Name the maneuver type for one generated trail route navigation instruction.
 *
 */
package com.trailmapper.shared.routing

enum class TrailRouteInstructionManeuver {
    Start,
    Continue,
    SlightLeft,
    TurnLeft,
    SharpLeft,
    SlightRight,
    TurnRight,
    SharpRight,
    TurnAround,
    Arrive,
}
