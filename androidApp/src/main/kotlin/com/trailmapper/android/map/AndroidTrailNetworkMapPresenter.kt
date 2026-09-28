/**
 * Job: Launch the Android overview of county trails and verified local additions.
 *
 */
package com.trailmapper.android.map

import android.app.Activity
import android.content.Context
import android.content.Intent
import com.trailmapper.shared.TrailNetworkMapPresenter

class AndroidTrailNetworkMapPresenter(
    private val context: Context,
) : TrailNetworkMapPresenter {
    override val isAvailable: Boolean = true

    override fun showTrailNetwork() {
        val intent = Intent(context, TrailNetworkOverviewActivity::class.java)
        if (context !is Activity) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
