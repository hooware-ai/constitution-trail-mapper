package com.trailmapper.shared

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf

/** Platform-owned window presentation; the default leaves non-Android platforms unchanged. */
val LocalPlatformModalWindowAppearance = staticCompositionLocalOf<@Composable (String) -> Unit> { {} }
