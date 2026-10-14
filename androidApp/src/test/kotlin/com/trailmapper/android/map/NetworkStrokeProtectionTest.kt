package com.trailmapper.android.map
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import kotlin.test.Test
import kotlin.test.assertTrue
class NetworkStrokeProtectionTest {
    private fun contrast(a: Color, b: Color): Double {
        val x = a.luminance().toDouble(); val y = b.luminance().toDouble()
        return (maxOf(x,y)+0.05)/(minOf(x,y)+0.05)
    }
    @Test fun preservedSemanticColorsContrastWithTheirImmediateWhiteCasing() {
        val inner = networkStrokeCasings(8f).last().color
        for (color in listOf(TrailColor,ParkColor,SharedRoadColor,SupplementColor,ProposedColor)) {
            assertTrue(contrast(color,inner)>=3.0)
        }
    }
    @Test fun casingsSeparateMeaningfulSegmentsFromBothLightAndDarkTiles() {
        for (width in listOf(6f,8f)) {
            val casings = networkStrokeCasings(width)
            assertTrue(casings.size >= 2)
            assertTrue(casings.all { it.width > width && it.zOffset > 0 })
            assertTrue(casings[0].width > casings[1].width)
            assertTrue(contrast(casings[0].color,casings[1].color)>=3.0)
            for (channel in 0..255) {
                val tile = Color(channel,channel,channel)
                assertTrue(casings.any { contrast(it.color,tile)>=3.0 }, "tile $channel")
            }
        }
    }
}
