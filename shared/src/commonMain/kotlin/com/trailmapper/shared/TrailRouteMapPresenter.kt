/**
 * Job: Provide a platform hook for displaying a computed trail route on a native map.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute

interface TrailRouteMapPresenter {
    val isAvailable: Boolean

    fun showTrailRoute(
        route: TrailRoute,
        preview: TrailRoutePreviewRequest = TrailRoutePreviewRequest(),
    )
}
