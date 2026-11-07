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
    @Test fun gestureAndThreeButtonTransitionsHaveDifferentBackdropPolicies() {
        assertFalse(usesLightNavigationIcons(36, false, false))
        assertTrue(usesLightNavigationIcons(36, false, true))
        assertTrue(usesLightNavigationIcons(36, true, false))
        val tracker = SystemBarAppearanceTracker(false)
        val inset = SystemBarInsets(0,0,0,24)
        assertTrue(tracker.needsRefresh(inset,true,true,false))
        assertFalse(tracker.needsRefresh(inset,true,true,false))
        assertTrue(tracker.needsRefresh(inset,true,false,true))
        assertFalse(tracker.needsRefresh(inset,true,false,true))
        assertTrue(tracker.needsRefresh(inset,true,true,false))
    }
    @Test fun modernStatusPolarityStaysWhiteAcrossContentThemesAndFocusReturn() {
        for (dark in listOf(false,true)) {
            assertFalse(usesDarkStatusIcons(36,dark))
            val tracker = SystemBarAppearanceTracker(dark)
            val insets = SystemBarInsets(0,0,0,24)
            assertTrue(tracker.needsRefresh(insets,false,!dark,dark,false))
            assertFalse(tracker.needsRefresh(insets,false,!dark,dark,false))
            tracker.onWindowFocusGained()
            assertTrue(tracker.needsRefresh(insets,false,!dark,dark,false))
        }
        assertTrue(usesDarkStatusIcons(34,false))
        assertFalse(usesDarkStatusIcons(34,true))
    }
    @Test fun staleModernStatusAppearanceHasABoundedBudgetAndCleanObservationRearmsIt() {
        val api = 35
        for (dark in listOf(false,true)) {
            val expectedLightStatus = usesDarkStatusIcons(api, dark)
            assertFalse(expectedLightStatus)
            val tracker = SystemBarAppearanceTracker(dark)
            val insets = SystemBarInsets(0,0,0,24)
            fun observe(lightStatus: Boolean) = tracker.needsRefresh(
                insets = insets,
                lightStatus = lightStatus,
                lightNavigation = !dark,
                expectedLightNavigationIcons = dark,
                expectedLightStatus = expectedLightStatus,
            )
            repeat(3) { assertTrue(observe(lightStatus = true)) }
            repeat(100) { assertFalse(observe(lightStatus = true)) }
            assertFalse(observe(lightStatus = false))
            assertTrue(observe(lightStatus = true))
        }
        assertFalse(usesDarkStatusIcons(35,false))
        assertFalse(usesDarkStatusIcons(35,true))
    }
    @Test fun protectionCoversOnlyNavigationInsetIncludingLandscapeSides() {
        assertEquals(listOf(NavigationProtectionRect(0f, 752f, 400f, 48f)), navigationProtectionRects(400f, 800f, SystemBarInsets(0,0,0,48)))
        assertEquals(listOf(NavigationProtectionRect(0f, 0f, 48f, 400f)), navigationProtectionRects(800f, 400f, SystemBarInsets(48,0,0,0)))
        assertEquals(listOf(NavigationProtectionRect(752f, 0f, 48f, 400f)), navigationProtectionRects(800f, 400f, SystemBarInsets(0,0,48,0)))
        assertTrue(navigationProtectionRects(400f,800f,SystemBarInsets(0,0,0,0)).isEmpty())
    }
}
