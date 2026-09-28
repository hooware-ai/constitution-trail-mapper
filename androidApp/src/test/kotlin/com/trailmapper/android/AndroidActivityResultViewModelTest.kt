/**
 * Job: Verify platform result and account requests survive host recreation without stale deliveries.
 *
 */
package com.trailmapper.android

import com.trailmapper.shared.TrailAccountProvider
import com.trailmapper.shared.TrailAccountResult
import com.trailmapper.shared.TrailUserAccount
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest

@OptIn(ExperimentalCoroutinesApi::class)
class AndroidActivityResultViewModelTest {
    @Test
    fun resultAfterHostRecreationResumesOriginalCallerWithoutRelaunching() = runTest {
        val results = PendingActivityResult<String, String>("cancelled")
        val launches = mutableListOf<String>()
        results.attach { launches += "old:$it" }
        val result = async { results.request("pick") }
        runCurrent()

        results.detach()
        results.attach { launches += "new:$it" }
        results.complete("selected")

        assertEquals("selected", result.await())
        assertEquals(listOf("old:pick"), launches)
    }

    @Test
    fun requestDuringRecreationWaitsForNewHost() = runTest {
        val results = PendingActivityResult<String, String>("cancelled")
        val launches = mutableListOf<String>()
        results.attach { launches += "old:$it" }
        results.detach()
        val result = async { results.request("pick") }
        runCurrent()
        assertFalse(result.isCompleted)
        assertTrue(launches.isEmpty())

        results.attach { launches += "new:$it" }
        results.complete("selected")
        assertEquals("selected", result.await())
        assertEquals(listOf("new:pick"), launches)
    }

    @Test
    fun cancelledRequestResultCannotResumeANewerCaller() = runTest {
        val results = PendingActivityResult<String, String>("cancelled")
        val launches = mutableListOf<String>()
        results.attach(launches::add)
        val original = async { results.request("original") }
        runCurrent()
        original.cancel()
        runCurrent()

        assertEquals("cancelled", results.request("too soon"))
        results.complete("old selection")
        val replacement = async { results.request("replacement") }
        runCurrent()
        results.complete("new selection")

        assertEquals("new selection", replacement.await())
        assertEquals(listOf("original", "replacement"), launches)
    }

    @Test
    fun cancellationBeforeHostReturnsDoesNotLaunchAbandonedRequest() = runTest {
        val results = PendingActivityResult<String, String>("cancelled")
        val launches = mutableListOf<String>()
        val result = async { results.request("abandoned") }
        runCurrent()
        result.cancel()
        runCurrent()
        results.attach(launches::add)
        assertTrue(launches.isEmpty())
    }

    @Test
    fun launchFailureReleasesResultSlotForRetry() = runTest {
        val results = PendingActivityResult<String, String>("cancelled")
        results.attach { error("launch failed") }
        val failure = runCatching { results.request("first") }.exceptionOrNull()
        assertEquals("launch failed", failure?.message)
        results.attach { results.complete("selected") }
        assertEquals("selected", results.request("retry"))
    }

    @Test
    fun accountCallsUseReplacementHostAndIgnoreLateDetach() = runTest {
        val bridge = AndroidActivityResultViewModel()
        val oldHost = Any()
        val newHost = Any()
        val oldAccount = FakeAccountProvider("old")
        val newAccount = FakeAccountProvider("new")
        bridge.attach(oldHost, oldAccount)
        bridge.detach(oldHost)
        bridge.attach(newHost, newAccount)
        bridge.detach(oldHost)

        assertEquals("new", bridge.currentAccount()?.id)
        assertEquals(TrailAccountResult.Success(newAccount.account), bridge.signIn())
        assertEquals(0, oldAccount.signInCount)
        assertEquals(1, newAccount.signInCount)
        bridge.detach(newHost)
        assertNull(bridge.currentAccount())
    }

    @Test
    fun destroyedHostCancelsItsSignInWithoutCancellingCaller() = runTest {
        val bridge = AndroidActivityResultViewModel()
        val host = Any()
        val account = FakeAccountProvider("old", CompletableDeferred())
        bridge.attach(host, account)
        val result = async { bridge.signIn() }
        runCurrent()
        bridge.detach(host)
        assertEquals(TrailAccountResult.Cancelled, result.await())
    }

    private fun AndroidActivityResultViewModel.attach(owner: Any, provider: TrailAccountProvider) {
        attach(
            owner = owner,
            launchPermissions = {},
            launchSettings = {},
            launchMapPoint = {},
            trailAccountProvider = provider,
        )
    }

    private class FakeAccountProvider(
        id: String,
        private val signInGate: CompletableDeferred<Unit>? = null,
    ) : TrailAccountProvider {
        val account = TrailUserAccount(
            id = id,
            displayName = id,
            email = "$id@example.test",
            profileImageUrl = null,
        )
        var signInCount = 0

        override suspend fun currentAccount(): TrailUserAccount = account

        override suspend fun signIn(): TrailAccountResult {
            signInCount++
            signInGate?.await()
            return TrailAccountResult.Success(account)
        }

        override suspend fun signOut() = Unit
    }
}
