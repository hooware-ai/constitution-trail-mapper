/**
 * Job: Decide when a manually entered saved destination is complete enough to save.
 *
 */
package com.trailmapper.shared.sijko

object SavedDestinationEditorSaveAvailabilitySijko {
    fun canSave(
        name: String,
        address: String,
        point: MapPoint?,
    ): Boolean {
        return name.isNotBlank() &&
            address.isNotBlank() &&
            point != null
    }
}
