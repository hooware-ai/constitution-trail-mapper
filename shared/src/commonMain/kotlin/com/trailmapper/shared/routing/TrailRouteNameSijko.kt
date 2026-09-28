/**
 * Job: Normalize and compare source-provided street and trail names consistently across routing layers.
 *
 */
package com.trailmapper.shared.routing

object TrailRouteNameSijko {
    fun normalized(name: String?): String? {
        return name?.trim()?.takeIf { it.isNotEmpty() }
    }

    fun matches(
        first: String?,
        second: String?,
    ): Boolean {
        return normalized(first).equals(normalized(second), ignoreCase = true)
    }
}
