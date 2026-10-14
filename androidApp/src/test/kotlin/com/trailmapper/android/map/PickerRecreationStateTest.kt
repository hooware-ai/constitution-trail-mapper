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
}
