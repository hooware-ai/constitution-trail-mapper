/**
 * Job: Open shared Constitution Trail resource links through iOS URL handling.
 *
 */
package com.trailmapper.shared

import platform.Foundation.NSURL
import platform.UIKit.UIApplication

class IOSExternalLinkOpener : ExternalLinkOpener {
    override fun open(url: String) {
        val nsUrl = NSURL.URLWithString(url) ?: return
        UIApplication.sharedApplication.openURL(nsUrl)
    }
}
