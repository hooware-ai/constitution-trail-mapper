/**
 * Job: Present Google's approved Android sign-in button asset as an accessible action.
 *
 */
package com.trailmapper.shared

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp

@Composable
internal actual fun TrailGoogleSignInButton(
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Image(
        painter = painterResource(R.drawable.sign_in_with_google_neutral),
        contentDescription = "Sign in with Google",
        modifier = Modifier
            .size(width = 180.dp, height = 40.dp)
            .alpha(if (enabled) 1f else 0.38f)
            .clickable(
                enabled = enabled,
                role = Role.Button,
                onClick = onClick,
            ),
    )
}
