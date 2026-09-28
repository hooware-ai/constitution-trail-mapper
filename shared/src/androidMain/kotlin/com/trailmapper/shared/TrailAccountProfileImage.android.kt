/**
 * Job: Load Google account photos on Android and fall back to the account initial when unavailable.
 *
 */
package com.trailmapper.shared

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil3.compose.SubcomposeAsyncImage
import coil3.compose.SubcomposeAsyncImageContent

@Composable
internal actual fun TrailAccountProfileImage(
    account: TrailUserAccount,
    contentDescription: String?,
    modifier: Modifier,
) {
    val profileImageUrl = account.profileImageUrl
    if (profileImageUrl.isNullOrBlank()) {
        TrailAccountInitialAvatar(
            account = account,
            contentDescription = contentDescription,
            modifier = modifier,
        )
        return
    }

    SubcomposeAsyncImage(
        model = profileImageUrl,
        contentDescription = contentDescription,
        modifier = modifier.clip(CircleShape),
        contentScale = ContentScale.Crop,
        loading = {
            TrailAccountInitialAvatar(
                account = account,
                modifier = Modifier.fillMaxSize(),
            )
        },
        error = {
            TrailAccountInitialAvatar(
                account = account,
                modifier = Modifier.fillMaxSize(),
            )
        },
        success = { SubcomposeAsyncImageContent() },
    )
}
