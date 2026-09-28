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
}
