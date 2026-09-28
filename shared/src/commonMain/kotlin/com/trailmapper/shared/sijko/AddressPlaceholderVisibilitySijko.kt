/**
 * Job: Decide when an address input should display its placeholder text.
 *
 */
package com.trailmapper.shared.sijko

object AddressPlaceholderVisibilitySijko {
    fun shouldShowPlaceholder(value: String, isFocused: Boolean): Boolean {
        return value.isEmpty() && !isFocused
    }
}
