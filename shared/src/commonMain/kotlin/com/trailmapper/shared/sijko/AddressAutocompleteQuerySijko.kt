/**
 * Job: Decide whether endpoint text is specific enough to request autocomplete suggestions.
 *
 */
package com.trailmapper.shared.sijko

object AddressAutocompleteQuerySijko {
    fun shouldSearch(query: String): Boolean {
        return query.trim().length >= MINIMUM_QUERY_LENGTH
    }

    private const val MINIMUM_QUERY_LENGTH = 3
}
