package com.trailmapper.shared

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Theme selection changes presentation only; never routing, storage or provider policy. */
fun trailMapperColorScheme(darkTheme: Boolean): ColorScheme =
    if (darkTheme) TrailMapperDarkColors else TrailMapperLightColors

@Composable
fun TrailMapperTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(colorScheme = trailMapperColorScheme(darkTheme), content = content)
}

private val TrailMapperLightColors = lightColorScheme(
    primary = Color(0xFF08725F),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFCDEFE7),
    onPrimaryContainer = Color(0xFF093B33),
    secondary = Color(0xFF4D6888),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFDDE8F3),
    onSecondaryContainer = Color(0xFF18324B),
    tertiary = Color(0xFFF59E0B),
    onTertiary = Color(0xFF2E1C00),
    background = Color(0xFFF8FBF7),
    onBackground = Color(0xFF18211F),
    surface = Color.White,
    onSurface = Color(0xFF18211F),
    surfaceVariant = Color(0xFFE7F0EC),
    onSurfaceVariant = Color(0xFF4C5A56),
    error = Color(0xFFB3261E),
    onError = Color.White,
)

private val TrailMapperDarkColors = darkColorScheme(
    primary = Color(0xFF8BDCC0),
    onPrimary = Color(0xFF052D21),
    primaryContainer = Color(0xFF174C3B),
    onPrimaryContainer = Color(0xFFCEEFE1),
    secondary = Color(0xFFAFC6E7),
    onSecondary = Color(0xFF18324B),
    secondaryContainer = Color(0xFF284763),
    onSecondaryContainer = Color(0xFFD7EBFF),
    tertiary = Color(0xFFFFCA78),
    onTertiary = Color(0xFF432A00),
    tertiaryContainer = Color(0xFF593D12),
    onTertiaryContainer = Color(0xFFFFDEA6),
    background = Color(0xFF101C17),
    onBackground = Color(0xFFE3F3EA),
    surface = Color(0xFF1A2C23),
    onSurface = Color(0xFFE3F3EA),
    surfaceVariant = Color(0xFF294137),
    onSurfaceVariant = Color(0xFFB9CEC2),
    outline = Color(0xFF93AFA0),
    outlineVariant = Color(0xFF435B4E),
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),
    inverseSurface = Color(0xFFE3F3EA),
    inverseOnSurface = Color(0xFF263C31),
    inversePrimary = Color(0xFF08725F),
    surfaceTint = Color(0xFF8BDCC0),
    surfaceContainerLowest = Color(0xFF0C1712),
    surfaceContainerLow = Color(0xFF16271E),
    surfaceContainer = Color(0xFF1A2C23),
    surfaceContainerHigh = Color(0xFF20352A),
    surfaceContainerHighest = Color(0xFF294137),
    surfaceBright = Color(0xFF294137),
    surfaceDim = Color(0xFF101C17),
)
