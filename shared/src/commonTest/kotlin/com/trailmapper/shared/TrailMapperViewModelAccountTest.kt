/**
 * Job: Verify sign-in cancel, failure and sign-out leave saved routes and places on the device and explain the result.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.sijko.TrailAccountSheetContent
import com.trailmapper.shared.sijko.TrailAccountSheetSijko
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

@OptIn(ExperimentalCoroutinesApi::class)
class TrailMapperViewModelAccountTest {
    private val dispatcher = StandardTestDispatcher()
    private val account = TrailUserAccount(id = "1", displayName = "Rider", email = "rider@example.com", profileImageUrl = null)

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun cancellingSignInReturnsToSignedOutWithoutAMessage() = runTest(dispatcher) {
        val viewModel = viewModel(FakeAccountProvider(signInResult = TrailAccountResult.Cancelled))
        advanceUntilIdle()

        viewModel.signInWithGoogle()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertNull(state.account)
        assertFalse(state.isResolvingAccount)
        assertNull(state.accountMessage)
        assertEquals(1, state.savedRoutes.size)
    }

    @Test
    fun aFailedSignInKeepsTheErrorAndLocalData() = runTest(dispatcher) {
        val viewModel = viewModel(FakeAccountProvider(signInResult = TrailAccountResult.Error("Could not reach Google.")))
        advanceUntilIdle()

        viewModel.signInWithGoogle()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertNull(state.account)
        assertFalse(state.isResolvingAccount)
        assertEquals("Could not reach Google.", state.accountMessage)
        assertEquals(1, state.savedRoutes.size)
    }

    @Test
    fun signingOutSaysRoutesAreStillOnThisDevice() = runTest(dispatcher) {
        val viewModel = viewModel(FakeAccountProvider(signInResult = TrailAccountResult.Success(account), current = account))
        advanceUntilIdle()

        viewModel.signOut()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertNull(state.account)
        assertEquals(TrailAccountSheetSijko.SIGNED_OUT_NOTICE, state.accountMessage)
        assertEquals(1, state.savedRoutes.size)
    }

    @Test
    fun aDelayedSignOutShowsSigningOutUntilItFinishes() = runTest(dispatcher) {
        val gate = CompletableDeferred<Unit>()
        val provider = FakeAccountProvider(
            signInResult = TrailAccountResult.Success(account),
            current = account,
            signOutGate = gate,
        )
        val viewModel = viewModel(provider)
        advanceUntilIdle()

        viewModel.signOut()
        runCurrent()

        val pending = viewModel.uiState.value
        assertEquals(
            TrailAccountSheetContent.InProgress(TrailAccountSheetSijko.SIGNING_OUT_LABEL),
            TrailAccountSheetSijko.contentFor(pending.account, pending.isResolvingAccount, pending.accountMessage),
        )

        gate.complete(Unit)
        advanceUntilIdle()

        val done = viewModel.uiState.value
        assertEquals(
            TrailAccountSheetContent.SignedOut(problem = null, notice = TrailAccountSheetSijko.SIGNED_OUT_NOTICE),
            TrailAccountSheetSijko.contentFor(done.account, done.isResolvingAccount, done.accountMessage),
        )
    }

    @Test
    fun retryingAfterAFailureClearsTheOldError() = runTest(dispatcher) {
        val provider = FakeAccountProvider(signInResult = TrailAccountResult.Error("Could not reach Google."))
        val viewModel = viewModel(provider)
        advanceUntilIdle()
        viewModel.signInWithGoogle()
        advanceUntilIdle()

        provider.signInResult = TrailAccountResult.Success(account)
        viewModel.signInWithGoogle()
        advanceUntilIdle()

        assertEquals(account, viewModel.uiState.value.account)
    }

    private fun viewModel(provider: TrailAccountProvider): TrailMapperViewModel {
        return TrailMapperViewModel(
            savedTrailRouteStore = OneRouteStore(),
            savedDestinationStore = NoSavedDestinationStore,
            trailAccountProvider = provider,
        )
    }

    private class FakeAccountProvider(
        var signInResult: TrailAccountResult,
        private val current: TrailUserAccount? = null,
        private val signOutGate: CompletableDeferred<Unit>? = null,
    ) : TrailAccountProvider {
        override suspend fun currentAccount(): TrailUserAccount? = current

        override suspend fun signIn(): TrailAccountResult = signInResult

        override suspend fun signOut() {
            signOutGate?.await()
        }
    }

    private class OneRouteStore : SavedTrailRouteStore {
        private val route = TrailRoute(
            edges = emptyList(),
            totalDistanceMeters = 1609.34,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1609.34,
            kind = TrailRouteKind.Navigation,
        )
        private val saved = SavedTrailRoute(id = "route-1", title = "Saved route 1", summary = "1.0 mi trail route", route = route)

        override suspend fun savedRoutes(): List<SavedTrailRoute> = listOf(saved)

        override suspend fun saveRoute(route: TrailRoute, title: String): SavedTrailRoute = saved

        override suspend fun renameRoute(id: String, title: String): SavedTrailRoute? = null

        override suspend fun replaceRoute(id: String, route: TrailRoute): SavedTrailRoute? = null

        override suspend fun deleteRoute(id: String): Boolean = false
    }
}
