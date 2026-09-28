/**
 * Job: Represent platforms without a native trail-network overview.
 *
 */
package com.trailmapper.shared

object NoTrailNetworkMapPresenter : TrailNetworkMapPresenter {
    override val isAvailable: Boolean = false

    override fun showTrailNetwork() = Unit
}
