/**
 * Job: Build concise saved-item status messages for visible and spoken feedback.
 *
 */
package com.trailmapper.shared.sijko

object SavedItemAccessibilityMessageSijko {
    fun renamed(itemLabel: String, title: String): String =
        "${itemLabel.trim()} renamed to ${title.trim()}."

    fun deleted(itemLabel: String, title: String): String =
        "${itemLabel.trim()} ${title.trim()} deleted."
}
