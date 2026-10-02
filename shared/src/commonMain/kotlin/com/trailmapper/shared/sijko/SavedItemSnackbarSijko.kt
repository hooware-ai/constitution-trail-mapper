/**
 * Job: Give every Home snackbar a bounded lifetime so a waiting status message is never stuck behind one.
 *
 */
package com.trailmapper.shared.sijko

import androidx.compose.material3.SnackbarDuration

object SavedItemSnackbarSijko {
    /** Material3 makes a snackbar with an action Indefinite unless told otherwise; Undo must expire. */
    val undoDuration: SnackbarDuration = SnackbarDuration.Long

    val statusDuration: SnackbarDuration = SnackbarDuration.Short

    fun expires(duration: SnackbarDuration): Boolean = duration != SnackbarDuration.Indefinite
}
