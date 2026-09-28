/**
 * Job: Verify official Constitution Trail resource links are present and grouped for Explore and Updates.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.TrailResourceGroup
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
    fun eachGroupLeadsWithItsCurrentSourceAndTheDatedPaperMapComesLast() {
        val links = TrailResourceLinksSijko.links()
        val maps = links.filter { it.group == TrailResourceGroup.Maps }

        assertEquals("Latest county trail map", maps.first().title)
        assertEquals("https://www.constitutiontrail.org/trail-maps", maps.last().url)
        assertTrue(maps.last().description.orEmpty().contains("June 2022"))
        assertEquals("County road closures and construction", links.first { it.group == TrailResourceGroup.Notices }.title)
        assertTrue(links.filter { it.group == TrailResourceGroup.Rules }.any { it.title == "Normal trail rules" })
        // Every group has links, so no Explore or Updates heading is left empty.
        assertEquals(TrailResourceGroup.entries.toSet(), links.map { it.group }.toSet())
    }

    @Test
    fun futureStateLawKeepsItsEffectiveDateVisible() {
        val law = TrailResourceLinksSijko.links()
            .single { it.url == "https://ilga.gov/ftp/Public%20Acts/104/104-0854.htm" }

        assertTrue(law.title.contains("Jan. 1, 2027"))
        assertTrue(law.description.orEmpty().contains("effective January 1, 2027"))
    }
}
