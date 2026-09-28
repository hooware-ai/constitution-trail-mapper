/**
 * Job: Open shared Constitution Trail resource links through Android browser intents.
 *
 */
package com.trailmapper.android

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.trailmapper.shared.ExternalLinkOpener

class AndroidExternalLinkOpener(
    private val context: Context,
) : ExternalLinkOpener {
    override fun open(url: String) {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, Uri.parse(url)),
        )
    }
}
