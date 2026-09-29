/**
 * Job: Lock the About screen's current local-data, sign-in, location, and safety disclosures.
 *
 */
package com.trailmapper.shared

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
    fun helpTopicsExplainRoutesProposedTrailsAndEstimatedAccess() {
        val sections = TrailMapperAbout.disclosureSections().associate { it.title to it.body }

        assertTrue(sections.getValue("Planning a ride").contains("Go somewhere"))
        assertTrue(sections.getValue("Planning a ride").contains("Make an exercise loop"))
        assertTrue(sections.getValue("What a route means").contains("not a promise"))
        val proposed = sections.getValue("Proposed trails and estimated access")
        assertTrue(proposed.contains("Proposed trails are not open"))
        assertTrue(proposed.contains("stay off unless you turn them on"))
        assertTrue(proposed.contains("Neither includes live road closures"))
    }

    @Test
    fun estimatedAccessIsDescribedAsAnUnverifiedLinkNotARoutedRoad() {
        val proposed = TrailMapperAbout.disclosureSections()
            .single { it.title == "Proposed trails and estimated access" }
            .body

        assertTrue(proposed.contains("mapped roads and paths when a connection is found"))
        assertTrue(proposed.contains("estimated access instead"))
        assertTrue(proposed.contains("straight, unverified link"))
        assertTrue(proposed.contains("may not follow a usable road or path"))
        assertFalse(proposed.contains("part of a route on ordinary roads"))
    }

    @Test
    fun theProposedTrailsCautionMatchesTheHelpTopic() {
        assertTrue(TrailMapperAbout.PROPOSED_TRAILS_CAUTION.contains("not open"))
    }

    @Test
    fun keepsSectionTitlesUniqueSoTheyCanKeyTheList() {
        val titles = TrailMapperAbout.disclosureSections().map { it.title }

        assertEquals(titles.distinct(), titles)
    }

    @Test
    fun keepsSafetyAndIndependenceSections() {
        val titles = TrailMapperAbout.disclosureSections().map { it.title }

        assertTrue("Safety" in titles)
        assertTrue("Independent project" in titles)
    }
}
