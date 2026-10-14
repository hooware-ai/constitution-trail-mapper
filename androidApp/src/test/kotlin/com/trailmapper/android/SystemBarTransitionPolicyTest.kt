package com.trailmapper.android

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SystemBarTransitionPolicyTest {
    @Test fun navigationModeChangesRefreshEvenWhenThemeAndReportedFlagsAreUnchanged() {
        val tracker = SystemBarAppearanceTracker(false)
        val gesture = SystemBarInsets(0, 0, 0, 24)
        val buttons = SystemBarInsets(0, 0, 0, 48)
        assertTrue(tracker.needsRefresh(gesture, true, true))
        assertFalse(tracker.needsRefresh(gesture, true, true))
        assertTrue(tracker.needsRefresh(buttons, true, true))
        assertTrue(tracker.needsRefresh(gesture, true, true))
        assertFalse(tracker.needsRefresh(gesture, true, true))
    }
    @Test fun platformAppearanceDriftIsRepairedInBothModesIncludingSideNavigation() {
        for (dark in listOf(false, true)) {
            val tracker = SystemBarAppearanceTracker(dark)
            val bottom = SystemBarInsets(0, 0, 0, 48)
            tracker.needsRefresh(bottom, !dark, !dark)
            assertTrue(tracker.needsRefresh(bottom, dark, !dark))
            assertTrue(tracker.needsRefresh(bottom, !dark, dark))
            assertTrue(tracker.needsRefresh(SystemBarInsets(48, 0, 0, 0), !dark, !dark))
        }
    }
}
