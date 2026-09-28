/**
 * Job: Provide saved-card long-press input and semantics without adding a click action.
 *
 */
package com.trailmapper.shared

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.semantics

internal fun Modifier.savedItemLongPressOnly(
    onLongClickLabel: String?,
    onLongPress: (() -> Unit)?,
): Modifier {
    if (onLongPress == null) {
        return this
    }

    return this
        .pointerInput(onLongPress) {
            detectTapGestures(
                onLongPress = { onLongPress() },
            )
        }
        .semantics {
            onLongClick(label = onLongClickLabel) {
                onLongPress()
                true
            }
        }
}
