/**
 * Job: Define the platform-specific Google sign-in button used by the shared account sheet.
 *
 */
package com.trailmapper.shared

import androidx.compose.runtime.Composable

@Composable
internal expect fun TrailGoogleSignInButton(
    enabled: Boolean,
    onClick: () -> Unit,
)
