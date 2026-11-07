package com.trailmapper.android.map
import kotlin.test.Test
import kotlin.test.assertTrue
import kotlin.test.assertEquals
import android.view.inputmethod.EditorInfo
class ConstrainedMapLayoutTest {
    @Test fun overlayBudgetsLeaveAGapAtConstrainedLandscapeHeights() {
        for (height in listOf(0f,93f,166f,370f,985f,1080f)) {
            val b = routeMapOverlayBudget(height)
            assertTrue(b.header >= 0f && b.controls >= 0f)
            assertTrue(b.header + b.controls <= height)
            if (height > 0) assertTrue(height - b.header - b.controls >= height * 0.09f)
        }
    }
    @Test fun queryEditorPermitsFullscreenExtractionAndExposesDone() {
        val options = pickerQueryImeOptions()
        assertEquals(EditorInfo.IME_ACTION_DONE, options and EditorInfo.IME_MASK_ACTION)
        assertEquals(0, options and EditorInfo.IME_FLAG_NO_EXTRACT_UI)
        assertEquals(0, options and EditorInfo.IME_FLAG_NO_FULLSCREEN)
    }
}
