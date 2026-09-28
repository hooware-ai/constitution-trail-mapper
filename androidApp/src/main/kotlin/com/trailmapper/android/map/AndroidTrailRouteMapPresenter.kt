/**
 * Job: Launch the Android route map screen for a computed shared trail route.
 *
 */
package com.trailmapper.android.map

import android.app.Activity
import android.content.Context
import android.content.Intent
import com.trailmapper.shared.TrailRouteMapPresenter
import com.trailmapper.shared.TrailRoutePreviewRequest
import com.trailmapper.shared.routing.TrailRoute

class AndroidTrailRouteMapPresenter(
    private val context: Context,
) : TrailRouteMapPresenter {
    override val isAvailable: Boolean = true

    override fun showTrailRoute(
        route: TrailRoute,
        preview: TrailRoutePreviewRequest,
    ) {
        val intent = TrailRouteMapActivity.createIntent(context, route, preview)
        if (context !is Activity) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
