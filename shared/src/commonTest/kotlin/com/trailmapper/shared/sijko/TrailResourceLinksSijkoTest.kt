/**
 * Job: Verify official Constitution Trail resource links are present for the app menu.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailResourceLinksSijkoTest {
    @Test
    fun includesCoreTrailResources() {
        val links = TrailResourceLinksSijko.links()

        assertTrue(links.any { it.url == "https://www.constitutiontrail.org/" })
        assertTrue(links.any { it.url == "https://www.constitutiontrail.org/trail-maps" })
        assertTrue(links.any { it.title == "Latest county trail map" })
        assertTrue(links.any { it.title == "Normal trail rules" })
        assertTrue(links.any { it.title == "Bloomington park and trail traffic rules" })
    }

    @Test
    fun allLinksUseHttps() {
        TrailResourceLinksSijko.links().forEach { link ->
            assertTrue(link.url.startsWith("https://"))
            assertTrue(!link.description.isNullOrBlank())
        }
    }

    @Test
    fun homePrioritizesCurrentMapAndClosureSourcesOverDatedPaperMap() {
        val links = TrailResourceLinksSijko.links()

        assertEquals(
            listOf("Latest county trail map", "County road closures and construction"),
            links.filter { it.showOnHome }.map { it.title },
        )
        val downloads = links.single { it.url == "https://www.constitutiontrail.org/trail-maps" }
        assertTrue(downloads.description.orEmpty().contains("June 2022"))
    }

    @Test
    fun futureStateLawKeepsItsEffectiveDateVisible() {
        val law = TrailResourceLinksSijko.links()
            .single { it.url == "https://ilga.gov/ftp/Public%20Acts/104/104-0854.htm" }

        assertTrue(law.title.contains("Jan. 1, 2027"))
        assertTrue(law.description.orEmpty().contains("effective January 1, 2027"))
    }
}
