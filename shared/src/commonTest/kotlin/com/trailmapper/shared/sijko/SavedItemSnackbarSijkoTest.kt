/**
 * Job: Verify an untouched Undo snackbar expires, so status messages queued behind it are still shown.
 *
 */
package com.trailmapper.shared.sijko

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

@OptIn(ExperimentalCoroutinesApi::class)
class SavedItemSnackbarSijkoTest {
    @Test
    fun undoAndStatusSnackbarsBothExpire() {
        assertTrue(SavedItemSnackbarSijko.expires(SavedItemSnackbarSijko.undoDuration))
        assertTrue(SavedItemSnackbarSijko.expires(SavedItemSnackbarSijko.statusDuration))
        assertFalse(SavedItemSnackbarSijko.expires(SnackbarDuration.Indefinite))
    }

    @Test
    fun statusMessagesShowInOrderOnceUndoExpires() = runTest {
        val host = SnackbarHostState()
        val shown = mutableListOf<String>()
        val undoOutcome = mutableListOf<SnackbarResult>()
        backgroundScope.fakeHost(host)

        // A recent route is removed and its Undo is left untouched, then two status messages arrive.
        launch {
            undoOutcome += host.showSnackbar(
                message = "Removed route from recents",
                actionLabel = "Undo",
                duration = SavedItemSnackbarSijko.undoDuration,
            )
        }
        runCurrent()
        for (text in listOf("Test Park saved.", "Unable to save route.")) {
            launch {
                host.showSnackbar(message = text, duration = SavedItemSnackbarSijko.statusDuration)
                shown += text
            }
        }
        runCurrent()
        assertEquals(emptyList(), shown)

        advanceTimeBy(MILLIS_LONG + MILLIS_SHORT * 2 + 1_000)
        runCurrent()

        assertEquals(listOf(SnackbarResult.Dismissed), undoOutcome)
        assertEquals(listOf("Test Park saved.", "Unable to save route."), shown)
    }

    @Test
    fun indefiniteUndoWouldBlockStatusMessages() = runTest {
        val host = SnackbarHostState()
        val shown = mutableListOf<String>()
        backgroundScope.fakeHost(host)

        backgroundScope.launch {
            host.showSnackbar(message = "Removed route from recents", actionLabel = "Undo", duration = SnackbarDuration.Indefinite)
        }
        runCurrent()
        backgroundScope.launch {
            host.showSnackbar(message = "Test Park saved.", duration = SavedItemSnackbarSijko.statusDuration)
            shown += "Test Park saved."
        }
        advanceTimeBy(MILLIS_LONG * 10)
        runCurrent()

        assertEquals(emptyList(), shown)
    }

    // Stands in for SnackbarHost: dismisses each snackbar after its duration; Indefinite never times out.
    private fun CoroutineScope.fakeHost(host: SnackbarHostState) = launch {
        while (true) {
            val data = host.currentSnackbarData
            if (data == null) {
                delay(10)
                continue
            }
            when (data.visuals.duration) {
                SnackbarDuration.Short -> delay(MILLIS_SHORT)
                SnackbarDuration.Long -> delay(MILLIS_LONG)
                SnackbarDuration.Indefinite -> awaitCancellation()
            }
            data.dismiss()
            delay(10) // let the dismissed snackbar leave currentSnackbarData
        }
    }

    private companion object {
        const val MILLIS_SHORT = 4_000L
        const val MILLIS_LONG = 10_000L
    }
}
