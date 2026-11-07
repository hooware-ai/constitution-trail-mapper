package com.trailmapper.shared

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import kotlin.math.max
import kotlin.math.min
import kotlin.test.Test
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class TrailMapperThemeContrastTest {
    @Test
    fun systemModesChooseDifferentReadablePalettes() {
        val light = trailMapperColorScheme(false)
        val dark = trailMapperColorScheme(true)
        assertNotEquals(light.background, dark.background)
        assertTrue(light.background.luminance() > 0.8f)
        assertTrue(dark.background.luminance() < 0.1f)
        for (scheme in listOf(light, dark)) {
            val pairs = listOf(
                "primary" to (scheme.onPrimary to scheme.primary),
                "primary container" to (scheme.onPrimaryContainer to scheme.primaryContainer),
                "secondary" to (scheme.onSecondary to scheme.secondary),
                "secondary container" to (scheme.onSecondaryContainer to scheme.secondaryContainer),
                "tertiary" to (scheme.onTertiary to scheme.tertiary),
                "tertiary container" to (scheme.onTertiaryContainer to scheme.tertiaryContainer),
                "background" to (scheme.onBackground to scheme.background),
                "surface" to (scheme.onSurface to scheme.surface),
                "surface variant" to (scheme.onSurfaceVariant to scheme.surfaceVariant),
                "error" to (scheme.onError to scheme.error),
                "error container" to (scheme.onErrorContainer to scheme.errorContainer),
                "inverse" to (scheme.inverseOnSurface to scheme.inverseSurface),
            )
            for ((name, pair) in pairs) {
                assertTrue(contrast(pair.first, pair.second) >= 4.5, "$name regular text contrast")
            }
            for (container in listOf(scheme.surfaceContainerLowest, scheme.surfaceContainerLow,
                scheme.surfaceContainer, scheme.surfaceContainerHigh, scheme.surfaceContainerHighest,
                scheme.surfaceBright, scheme.surfaceDim)) {
                assertTrue(contrast(scheme.onSurface, container) >= 4.5, "container text contrast")
                assertTrue(contrast(scheme.onSurfaceVariant, container) >= 4.5, "container secondary text contrast")
            }
            for (base in listOf(scheme.surface, scheme.background)) {
                assertTrue(contrast(scheme.primary, base) >= 4.5, "text button contrast")
                assertTrue(contrast(scheme.error, base) >= 4.5, "error text contrast")
            }
            assertTrue(contrast(scheme.outline, scheme.surface) >= 3.0, "input outline contrast")
        }
    }

    @Test
    fun idealizedSystemNavigationIconPolicyProxyHasHighContrastBackdropInBothModes() {
        assertTrue(contrast(Color.Black, trailMapperColorScheme(false).background) >= 3.0)
        assertTrue(contrast(Color.White, trailMapperColorScheme(true).background) >= 3.0)
    }

    private fun contrast(a: Color, b: Color): Double {
        val x = a.luminance().toDouble()
        val y = b.luminance().toDouble()
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }
}
