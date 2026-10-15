package com.trailmapper.android.map

import com.google.maps.android.compose.ComposeMapColorScheme
import kotlin.test.Test
import kotlin.test.assertEquals

class MapThemePolicyTest {
    @Test fun explicitMapsPaletteTracksBothSystemModesInsteadOfDefaultingToLight() {
        assertEquals(ComposeMapColorScheme.LIGHT, trailMapperMapColorScheme(false))
        assertEquals(ComposeMapColorScheme.DARK, trailMapperMapColorScheme(true))
    }
}
