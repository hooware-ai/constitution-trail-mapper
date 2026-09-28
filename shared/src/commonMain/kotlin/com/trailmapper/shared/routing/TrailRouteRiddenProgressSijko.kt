/**
 * Job: Track how far along the route the rider has credibly ridden, for showing ridden travel on the map.
 *
 */
package com.trailmapper.shared.routing

data class TrailRouteRiddenProgress(
    val riddenMeters: Double = 0.0,
    /** Progress a GPS jump landed on, waiting for continued on-route travel before it counts. */
    val pendingJumpMeters: Double? = null,
)

/**
 * Navigation progress can jump: an off-route position projects onto a far part of the loop, and a
 * position near the start can match the finish. Ridden progress advances only through on-route
 * positions in plausible forward steps. A jump is held until the rider keeps moving forward on the
 * route from where it landed (for example, after a real GPS gap), and only then does it count.
 */
object TrailRouteRiddenProgressSijko {
    fun next(previous: TrailRouteRiddenProgress, snapshot: TrailRouteNavigationSnapshot?): TrailRouteRiddenProgress {
        if (snapshot == null) {
            return previous
        }
        // A jump is confirmed only by unbroken on-route travel, so an off-route or backward reading
        // breaks the chain and the jump has to be re-established from scratch.
        if (snapshot.distanceFromRouteMeters > TrailRouteNavigationSnapshotSijko.OFF_ROUTE_METERS) {
            return previous.copy(pendingJumpMeters = null)
        }
        val progressMeters = snapshot.distanceAlongRouteMeters
        if (progressMeters <= previous.riddenMeters) {
            return previous.copy(pendingJumpMeters = null)
        }
        if (progressMeters <= previous.riddenMeters + MaximumStepMeters) {
            return TrailRouteRiddenProgress(riddenMeters = progressMeters)
        }
        val pendingJumpMeters = previous.pendingJumpMeters
        return when {
            pendingJumpMeters == null ||
                progressMeters < pendingJumpMeters ||
                progressMeters > pendingJumpMeters + MaximumStepMeters ->
                previous.copy(pendingJumpMeters = progressMeters)
            progressMeters - pendingJumpMeters >= JumpConfirmationMeters ->
                TrailRouteRiddenProgress(riddenMeters = progressMeters)
            else -> previous
        }
    }

    // Matches the exercise completion check's largest credited step.
    private const val MaximumStepMeters = 300.0
    private const val JumpConfirmationMeters = 150.0
}
