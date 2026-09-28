/**
 * Job: Verify account avatars always receive a useful, bounded fallback character.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class TrailAccountInitialSijkoTest {
    @Test
    fun usesTrimmedDisplayNameFirst() {
        assertEquals(
            expected = "J",
            actual = TrailAccountInitialSijko.initial(
                displayName = "  Jordan Rider",
                email = "another@example.com",
            ),
        )
    }

    @Test
    fun fallsBackToEmailWhenDisplayNameIsBlank() {
        assertEquals(
            expected = "R",
            actual = TrailAccountInitialSijko.initial(
                displayName = "  ",
                email = "rider@example.com",
            ),
        )
    }

    @Test
    fun usesQuestionMarkWhenAccountLabelsAreBlank() {
        assertEquals(
            expected = "?",
            actual = TrailAccountInitialSijko.initial(
                displayName = "",
                email = "  ",
            ),
        )
    }
}
