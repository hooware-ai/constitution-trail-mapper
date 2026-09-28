/**
 * Job: Lock the shared navigation destination routes against accidental collisions or renaming.
 *
 */
package com.trailmapper.shared

import kotlin.test.Test
import kotlin.test.assertEquals

class TrailMapperScreenTest {
    @Test
    fun routesAreStableAndUnique() {
        assertEquals("home", TrailMapperScreen.Home.route)
        assertEquals("route-planner", TrailMapperScreen.RoutePlanner.route)
        assertEquals("about", TrailMapperScreen.About.route)
        assertEquals(
            TrailMapperScreen.entries.size,
            TrailMapperScreen.entries.map(TrailMapperScreen::route).distinct().size,
        )
    }

    @Test
    fun homeTabsKeepTheirOrderAndSavedNamesWithPlanFirst() {
        // The selected tab is saved by name, and Plan is the start destination that Back returns to.
        assertEquals(listOf("Plan", "Saved", "Explore", "Updates"), TrailMapperHomeTab.entries.map { it.name })
        assertEquals(listOf("Plan", "Saved", "Explore", "Updates"), TrailMapperHomeTab.entries.map { it.label })
    }
}
