/**
 * Job: Derive a stable one-character fallback for a Trail Mapper account avatar.
 *
 */
package com.trailmapper.shared.sijko

object TrailAccountInitialSijko {
    fun initial(
        displayName: String,
        email: String,
    ): String {
        val source = displayName.trim().ifEmpty { email.trim() }
        return source.firstOrNull()?.uppercaseChar()?.toString() ?: "?"
    }
}
