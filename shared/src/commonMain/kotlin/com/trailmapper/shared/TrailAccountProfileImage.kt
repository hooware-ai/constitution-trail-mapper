/**
 * Job: Define the cross-platform account-avatar contract and its text fallback presentation.
 *
 */
package com.trailmapper.shared

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.trailmapper.shared.sijko.TrailAccountInitialSijko

@Composable
internal expect fun TrailAccountProfileImage(
    account: TrailUserAccount,
    contentDescription: String?,
    modifier: Modifier = Modifier,
)

@Composable
internal fun TrailAccountInitialAvatar(
    account: TrailUserAccount,
    contentDescription: String? = null,
    modifier: Modifier = Modifier,
) {
    val avatarModifier = if (contentDescription == null) {
        modifier
    } else {
        modifier.semantics {
            this.contentDescription = contentDescription
        }
    }
    Surface(
        modifier = avatarModifier,
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primaryContainer,
        contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
    ) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = TrailAccountInitialSijko.initial(
                    displayName = account.displayName,
                    email = account.email,
                ),
                style = MaterialTheme.typography.labelLarge,
            )
        }
    }
}
