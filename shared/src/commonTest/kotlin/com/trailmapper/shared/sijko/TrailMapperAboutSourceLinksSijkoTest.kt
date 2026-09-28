/**
 * Job: Verify About disclosures retain the required source roles and official links.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TrailMapperAboutSourceLinksSijkoTest {
    @Test
    fun includesEveryRequiredOfficialSource() {
        val links = TrailMapperAboutSourceLinksSijko.links()

        assertEquals(7, links.size)
        assertEquals(
            setOf(
                "McLean County GIS map",
                "Census TIGERweb",
                "OpenStreetMap copyright and ODbL",
                "Google Maps Platform",
                "MapLibre Native",
                "OpenFreeMap",
                "OpenMapTiles",
            ),
            links.map { it.title }.toSet(),
        )
    }

    @Test
    fun linksAreHttpsAndExplainTheirRole() {
        TrailMapperAboutSourceLinksSijko.links().forEach { link ->
            assertTrue(link.url.startsWith("https://"))
            assertTrue(link.role.isNotBlank())
        }
    }

    @Test
    fun openStreetMapRoleCoversRoutingAndSharedImages() {
        val openStreetMap = TrailMapperAboutSourceLinksSijko.links()
            .single { it.title == "OpenStreetMap copyright and ODbL" }

        assertTrue(openStreetMap.role.contains("endpoint access routing"))
        assertTrue(openStreetMap.role.contains("shared route images"))
    }

    @Test
    fun countyMapDisclosureDoesNotPromiseLiveRoutingOrClosureData() {
        val countyMap = TrailMapperAboutSourceLinksSijko.links()
            .single { it.title == "McLean County GIS map" }

        assertTrue(countyMap.role.contains("bundled trail geometry"))
        assertTrue(countyMap.role.contains("does not automatically refresh"))
        assertTrue(countyMap.role.contains("temporary closures"))
    }
}
