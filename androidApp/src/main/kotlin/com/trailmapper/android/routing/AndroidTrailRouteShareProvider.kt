/**
 * Job: Share saved trail routes through the Android system share sheet.
 *
 */
package com.trailmapper.android.routing

import android.content.Context
import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.TrailRouteShareProvider

class AndroidTrailRouteShareProvider(
    private val context: Context,
) : TrailRouteShareProvider {
    override val isAvailable: Boolean = true

    override fun share(savedRoute: SavedTrailRoute) {
        context.startActivity(
            TrailRouteImageShareActivity
                .createIntent(context, savedRoute)
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
