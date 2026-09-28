/**
 * Job: Preserve the shared account-sheet layout on iOS while native Google authorization is unavailable.
 *
 */
package com.trailmapper.shared

import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable

@Composable
internal actual fun TrailGoogleSignInButton(
    enabled: Boolean,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
    ) {
        Text("Sign in with Google")
    }
}
