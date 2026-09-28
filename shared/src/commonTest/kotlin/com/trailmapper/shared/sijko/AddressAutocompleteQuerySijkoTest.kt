/**
 * Job: Verify address autocomplete requests wait for useful query length.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AddressAutocompleteQuerySijkoTest {
    @Test
    fun waitsForAtLeastThreeNonBlankCharacters() {
        assertFalse(AddressAutocompleteQuerySijko.shouldSearch(""))
        assertFalse(AddressAutocompleteQuerySijko.shouldSearch("ab"))
        assertFalse(AddressAutocompleteQuerySijko.shouldSearch("  ab  "))
        assertTrue(AddressAutocompleteQuerySijko.shouldSearch("100"))
        assertTrue(AddressAutocompleteQuerySijko.shouldSearch("riv"))
    }
}
