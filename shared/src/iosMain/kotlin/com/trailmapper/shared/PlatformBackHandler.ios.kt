/**
 * Job: Keep the shared back-handler contract available on iOS, where this Android-only mode has no system Back action.
 *
 */
package com.trailmapper.shared

import androidx.compose.runtime.Composable

@Composable
internal actual fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
) = Unit
