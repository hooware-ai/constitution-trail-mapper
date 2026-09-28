/**
 * Job: Lock the About screen's current local-data, sign-in, location, and safety disclosures.
 *
 */
package com.trailmapper.shared

import kotlin.test.Test
import kotlin.test.assertTrue

class TrailMapperAboutTest {
    @Test
    fun disclosesCurrentDataAndLocationBehavior() {
        val dataAndPrivacy = TrailMapperAbout.disclosureSections()
            .single { it.title == "Data and privacy" }
            .body

        assertTrue(dataAndPrivacy.contains("saved locally"))
        assertTrue(dataAndPrivacy.contains("Google sign-in is optional"))
        assertTrue(dataAndPrivacy.contains("does not sync"))
        assertTrue(dataAndPrivacy.contains("request it for routing or navigation"))
    }

    @Test
    fun keepsSafetyAndIndependenceSections() {
        val titles = TrailMapperAbout.disclosureSections().map { it.title }

        assertTrue("Safety" in titles)
        assertTrue("Independent project" in titles)
    }
}
