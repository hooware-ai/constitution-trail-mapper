/**
 * Job: Verify placeholder visibility decisions for focused, empty, and populated address fields.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AddressPlaceholderVisibilitySijkoTest {
    @Test
    fun showsPlaceholderOnlyForEmptyUnfocusedField() {
        assertTrue(
            AddressPlaceholderVisibilitySijko.shouldShowPlaceholder(
                value = "",
                isFocused = false,
            ),
        )
        assertFalse(
            AddressPlaceholderVisibilitySijko.shouldShowPlaceholder(
                value = "",
                isFocused = true,
            ),
        )
        assertFalse(
            AddressPlaceholderVisibilitySijko.shouldShowPlaceholder(
                value = "Home",
                isFocused = false,
            ),
        )
    }

    @Test
    fun treatsWhitespaceAsEnteredText() {
        assertFalse(
            AddressPlaceholderVisibilitySijko.shouldShowPlaceholder(
                value = "   ",
                isFocused = false,
            ),
        )
    }
}
