/**
 * Job: Provide a platform hook for browsing the sourced trail network on a native map.
 *
 */
package com.trailmapper.shared

interface TrailNetworkMapPresenter {
    val isAvailable: Boolean

    fun showTrailNetwork()
}
