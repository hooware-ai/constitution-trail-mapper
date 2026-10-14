package com.trailmapper.android
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
class NavigationProtectionTest {
    @Test fun modernLightContentRequestsWhiteIconsOverDarkProtection() {
        for (api in listOf(35, 36)) for (dark in listOf(false, true)) {
            assertTrue(usesLightNavigationIcons(api, dark))
            val tracker = SystemBarAppearanceTracker(dark, true)
            val inset = SystemBarInsets(0, 0, 0, 48)
            assertTrue(tracker.needsRefresh(inset, !dark, false))
            assertFalse(tracker.needsRefresh(inset, !dark, false))
            assertTrue(tracker.needsRefresh(inset, !dark, true))
        }
        assertFalse(usesLightNavigationIcons(34, false))
        assertTrue(usesLightNavigationIcons(34, true))
    }
    @Test fun protectionCoversOnlyNavigationInsetIncludingLandscapeSides() {
        assertEquals(listOf(NavigationProtectionRect(0f, 752f, 400f, 48f)), navigationProtectionRects(400f, 800f, SystemBarInsets(0,0,0,48)))
        assertEquals(listOf(NavigationProtectionRect(0f, 0f, 48f, 400f)), navigationProtectionRects(800f, 400f, SystemBarInsets(48,0,0,0)))
        assertEquals(listOf(NavigationProtectionRect(752f, 0f, 48f, 400f)), navigationProtectionRects(800f, 400f, SystemBarInsets(0,0,48,0)))
        assertTrue(navigationProtectionRects(400f,800f,SystemBarInsets(0,0,0,0)).isEmpty())
    }
}
