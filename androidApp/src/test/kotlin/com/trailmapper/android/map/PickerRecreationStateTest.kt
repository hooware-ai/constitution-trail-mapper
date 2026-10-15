package com.trailmapper.android.map

import androidx.compose.runtime.saveable.SaverScope
import com.trailmapper.shared.sijko.MapPoint
import kotlin.test.Test
import kotlin.test.assertEquals

class PickerRecreationStateTest {
    @Test fun savedSelectionRoundTripsWithoutSubstitutingTheDefaultCameraPoint() {
        val selected = MapPoint(latitude = 40.513, longitude = -88.967)
        val scope = object : SaverScope { override fun canBeSaved(value: Any) = true }
        val saved = with(MapPointStateSaver) { scope.save(selected) }
        assertEquals(selected, MapPointStateSaver.restore(saved!!))
    }
    @Test fun restoredAddressPreviewPairSkipsReverseResolutionAndRejectsMovedSelection() {
        val point = MapPoint(latitude = 40.513, longitude = -88.967)
        val scope = object : SaverScope { override fun canBeSaved(value: Any) = true }
        val saved = with(NullableMapPointStateSaver) { scope.save(point) }
        val restored = NullableMapPointStateSaver.restore(saved!!)
        assertEquals(true, pickerAddressMatchesSelection(restored, point, "Named place"))
        assertEquals(false, pickerAddressMatchesSelection(restored, MapPoint(40.5, -88.9), "Named place"))
        assertEquals(false, pickerAddressMatchesSelection(restored, point, null))
    }
}
