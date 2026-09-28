/**
 * Job: Create a concise display title for a saved destination from its address text.
 *
 */
package com.trailmapper.shared.sijko

object SavedDestinationTitleSijko {
    fun titleFor(
        address: String,
        savedDestinationCount: Int,
        customName: String? = null,
    ): String {
        customName
            ?.trim()
            ?.takeIf { it.isNotBlank() }
            ?.let { return it }

        val firstAddressPart = address
            .split(',')
            .firstOrNull()
            ?.trim()
            .orEmpty()
        return firstAddressPart.takeIf { it.isNotBlank() }
            ?: "Saved destination ${savedDestinationCount + 1}"
    }
}
