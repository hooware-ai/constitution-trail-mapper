/**
 * Job: Normalize a user-edited saved route or destination title and reject blank names.
 *
 */
package com.trailmapper.shared.sijko

object SavedItemTitleEditSijko {
    fun normalizedTitle(input: String): String? {
        return input.trim().takeIf { title -> title.isNotEmpty() }
    }
}
