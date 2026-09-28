/**
 * Job: Represent platforms that do not yet have route-map display support wired.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute

object NoTrailRouteMapPresenter : TrailRouteMapPresenter {
    override val isAvailable: Boolean = false

    override fun showTrailRoute(
        route: TrailRoute,
        preview: TrailRoutePreviewRequest,
    ) = Unit
}
