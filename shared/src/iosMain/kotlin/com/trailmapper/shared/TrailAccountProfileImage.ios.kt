/**
 * Job: Render an account-initial avatar on iOS until a native remote-image loader is configured.
 *
 */
package com.trailmapper.shared

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
internal actual fun TrailAccountProfileImage(
    account: TrailUserAccount,
    contentDescription: String?,
    modifier: Modifier,
) {
    TrailAccountInitialAvatar(
        account = account,
        contentDescription = contentDescription,
        modifier = modifier,
    )
}
