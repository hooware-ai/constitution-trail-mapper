/**
 * Job: Verify saved-item status feedback stays concise, specific, and whitespace-safe.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class SavedItemAccessibilityMessageSijkoTest {
    @Test
    fun describesEditingActions() {
        assertEquals(
            "Editing Saved route 4. Rename or delete.",
            SavedItemAccessibilityMessageSijko.editing("  Saved route 4  "),
        )
    }

    @Test
    fun describesEditingExit() {
        assertEquals(
            "Exited edit mode for Downtown.",
            SavedItemAccessibilityMessageSijko.editingExited(" Downtown "),
        )
    }

    @Test
    fun describesRenameAndDeleteResults() {
        assertEquals(
            "Destination renamed to Home.",
            SavedItemAccessibilityMessageSijko.renamed(" Destination ", " Home "),
        )
        assertEquals(
            "Saved route Morning ride deleted.",
            SavedItemAccessibilityMessageSijko.deleted(" Saved route ", " Morning ride "),
        )
    }
}
