/**
 * Job: Build concise saved-item status messages for visible and spoken feedback.
 *
 */
package com.trailmapper.shared.sijko

object SavedItemAccessibilityMessageSijko {
    fun editing(title: String): String =
        "Editing ${title.trim()}. Rename or delete."

    fun editingExited(title: String): String =
        "Exited edit mode for ${title.trim()}."

    fun renamed(itemLabel: String, title: String): String =
        "${itemLabel.trim()} renamed to ${title.trim()}."

    fun deleted(itemLabel: String, title: String): String =
        "${itemLabel.trim()} ${title.trim()} deleted."
}
