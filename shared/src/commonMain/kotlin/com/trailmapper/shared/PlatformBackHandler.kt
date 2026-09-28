/**
 * Job: Define the shared contract for temporarily consuming platform back navigation.
 *
 */
package com.trailmapper.shared

import androidx.compose.runtime.Composable

@Composable
internal expect fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
)
