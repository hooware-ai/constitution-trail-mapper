package com.trailmapper.android.map
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.assertFalse
class ConstrainedMapLayoutTest {
    @Test fun opaquePanelsCannotOverlapEvenWhenTheirContentExceedsLandscapeViewport() {
        for (height in listOf(0f,93f,166f,370f,985f,1080f)) {
            val b = routeMapOverlayBudget(height)
            assertTrue(b.header >= 0f && b.controls >= 0f)
            assertTrue(b.header + b.controls <= height)
            if (height > 0) assertTrue(height - b.header - b.controls >= height * 0.09f)
        }
    }
    @Test fun fullFontLandscapeMayUseImeExtractionWithoutChangingPortraitOrOrdinaryFont() {
        assertTrue(pickerUsesExtractEditor(true,2f))
        assertTrue(pickerUsesExtractEditor(true,2.5f))
        assertFalse(pickerUsesExtractEditor(true,1f))
        assertFalse(pickerUsesExtractEditor(false,2f))
    }
}
