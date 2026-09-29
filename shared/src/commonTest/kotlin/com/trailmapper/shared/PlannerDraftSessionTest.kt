/**
 * Job: Verify draft restore, ownership and storage stay correct under cancellation, rotation and late discards.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpointTarget
import com.trailmapper.shared.sijko.RouteEndpoints
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withContext

@OptIn(ExperimentalCoroutinesApi::class)
class PlannerDraftSessionTest {
    private val dispatcher = StandardTestDispatcher()
    private val now = 1_000L
    private val point = MapPoint(40.5, -88.9)

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ---- 1: a form the rider cleared is not restored over ----

    @Test
    fun aClearedExerciseFieldIsNotBroughtBackByALaterRestore() {
        val viewModel = ExerciseRoutePlannerViewModel(NoCompletedExerciseSessionStore)
        viewModel.setTargetMilesText("5")
        val saved = assertNotNull(viewModel.toDraft(now))
        viewModel.setTargetMilesText("")

        viewModel.restoreDraft(saved)

        assertEquals("", viewModel.uiState.value.targetMilesText)
    }

    @Test
    fun onceSettledNoDraftCanBeRestoredEvenOnAnUntouchedForm() {
        val viewModel = ExerciseRoutePlannerViewModel(NoCompletedExerciseSessionStore)

        viewModel.closeDraftRestore()
        viewModel.restoreDraft(ExercisePlannerDraft(now, "Old", point, "5", false))

        assertEquals("", viewModel.uiState.value.startAddress)
    }

    // ---- 2: typing while the draft loads is kept ----

    @Test
    fun aDraftLoadedAfterTheRiderTypedDoesNotReplaceItOrBlankItOnPrepare() {
        val viewModel = RoutePlannerViewModel()
        viewModel.updateEndpointText(RouteEndpointTarget.Start, "Typed now", NoAddressAutocompleteProvider)

        viewModel.restoreDraft(RoutePlannerDraft(now, RouteEndpoints("Old draft", ""), RouteLayerDefaultsSijko.defaultSelection()))
        viewModel.prepareRoute(null)

        assertEquals("Typed now", viewModel.uiState.value.endpoints.start)
    }

    @Test
    fun aSettledRouteFormIgnoresALaterDraft() {
        val viewModel = RoutePlannerViewModel()
        viewModel.closeDraftRestore()

        viewModel.restoreDraft(RoutePlannerDraft(now, RouteEndpoints("Old", "Old too", point, point), RouteLayerDefaultsSijko.defaultSelection()))

        assertEquals("", viewModel.uiState.value.endpoints.start)
    }

    // ---- 3: an interrupted load can be retried ----

    @Test
    fun anInterruptedLoadRetriesAndOnlyThenBecomesReady() = runTest(dispatcher) {
        val gate = CompletableDeferred<String?>()
        var loads = 0
        var settled = 0
        val store = object : PlannerDraftStore {
            override suspend fun load(slot: String): String? {
                loads += 1
                return gate.await()
            }

            override suspend fun save(slot: String, serialized: String) = Unit

            override suspend fun clear(slot: String) = Unit
        }
        val session = PlannerDraftSession("route", PlannerDraftCoordinator(store), recreated = true, restore = {}, settle = { settled += 1 })

        val first = launch { session.restoreIfRecreated() }
        runCurrent()
        assertFalse(session.ready)
        first.cancelAndJoin()
        assertFalse(session.ready)
        assertEquals(0, settled)

        gate.complete(null)
        session.restoreIfRecreated()

        assertEquals(2, loads)
        assertEquals(1, settled)
        assertTrue(session.ready)
    }

    @Test
    fun aFreshVisitNeverLoadsButStillSettlesAndBecomesReady() = runTest(dispatcher) {
        var loads = 0
        var settled = 0
        val store = object : PlannerDraftStore {
            override suspend fun load(slot: String): String? {
                loads += 1
                return "stale"
            }

            override suspend fun save(slot: String, serialized: String) = Unit

            override suspend fun clear(slot: String) = Unit
        }
        val session = PlannerDraftSession("route", PlannerDraftCoordinator(store), recreated = false, restore = { error("must not restore") }, settle = { settled += 1 })

        session.restoreIfRecreated()

        assertEquals(0, loads)
        assertEquals(1, settled)
        assertTrue(session.ready)
    }

    // ---- 4: ordered storage and ownership checked when an operation runs ----

    private class FakeStore : PlannerDraftStore {
        val disk = mutableMapOf<String, String>()
        var gate: CompletableDeferred<Unit>? = null
        var writing: CompletableDeferred<Unit>? = null
        var uncancellableWrites = false

        override suspend fun load(slot: String): String? {
            gate?.await()
            return disk[slot]
        }

        override suspend fun save(slot: String, serialized: String) {
            if (uncancellableWrites) {
                // A write that has begun cannot be cancelled part way, like a blocking commit.
                withContext(NonCancellable) {
                    writing?.complete(Unit)
                    gate?.await()
                    disk[slot] = serialized
                }
            } else {
                disk[slot] = serialized
            }
        }

        override suspend fun clear(slot: String) {
            disk.remove(slot)
        }
    }

    @Test
    fun aClearWaitsForASaveThatIsAlreadyWritingSoTheDraftStaysCleared() = runTest(dispatcher) {
        val store = FakeStore().apply {
            uncancellableWrites = true
            gate = CompletableDeferred()
            writing = CompletableDeferred()
        }
        val coordinator = PlannerDraftCoordinator(store)
        val owner = Any()
        coordinator.claim("route", owner)

        val save = launch { coordinator.save("route", owner, "abandoned draft") }
        runCurrent()
        assertTrue(store.writing!!.isCompleted)
        save.cancel()
        val clear = launch { coordinator.clear("route", owner) }
        runCurrent()
        assertFalse(clear.isCompleted, "clear must wait for the write already in progress")

        store.gate!!.complete(Unit)
        runCurrent()

        assertTrue(clear.isCompleted)
        assertNull(store.disk["route"], "the cleared draft must not be revived by the cancelled save")
    }

    @Test
    fun aSaveCancelledBeforeItsTurnNeverWrites() = runTest(dispatcher) {
        val store = FakeStore().apply { gate = CompletableDeferred() }
        val coordinator = PlannerDraftCoordinator(store)
        val owner = Any()
        coordinator.claim("route", owner)

        val busy = launch { coordinator.load("route") }
        runCurrent()
        val waitingSave = launch { coordinator.save("route", owner, "queued draft") }
        runCurrent()
        waitingSave.cancel()
        store.gate!!.complete(Unit)
        runCurrent()

        assertTrue(busy.isCompleted)
        assertNull(store.disk["route"])
    }

    @Test
    fun aDelayedDiscardFromAnOlderVisitCannotEraseANewerVisitsDraft() = runTest(dispatcher) {
        val store = FakeStore().apply { gate = CompletableDeferred() }
        val coordinator = PlannerDraftCoordinator(store)
        val older = Any()
        val newer = Any()
        coordinator.claim("route", older)

        // The older screen is discarded, but its clear is still waiting for the lock when the next visit
        // starts, claims the slot and saves.
        val busy = launch { coordinator.load("route") }
        runCurrent()
        val oldDiscard = launch { coordinator.discard("route", older) }
        runCurrent()
        coordinator.claim("route", newer)
        val newSave = launch { coordinator.save("route", newer, "new draft") }
        runCurrent()

        store.gate!!.complete(Unit)
        runCurrent()

        assertTrue(busy.isCompleted && oldDiscard.isCompleted && newSave.isCompleted)
        assertEquals("new draft", store.disk["route"])
    }

    @Test
    fun aLateSaveFromAnOlderVisitCannotOverwriteANewerVisitsDraft() = runTest(dispatcher) {
        val store = FakeStore().apply { gate = CompletableDeferred() }
        val coordinator = PlannerDraftCoordinator(store)
        val older = Any()
        val newer = Any()
        coordinator.claim("route", older)

        val busy = launch { coordinator.load("route") }
        runCurrent()
        val oldSave = launch { coordinator.save("route", older, "old draft") }
        runCurrent()
        coordinator.claim("route", newer)
        val newSave = launch { coordinator.save("route", newer, "new draft") }
        runCurrent()

        store.gate!!.complete(Unit)
        runCurrent()

        assertTrue(busy.isCompleted && oldSave.isCompleted && newSave.isCompleted)
        assertEquals("new draft", store.disk["route"])
    }

    @Test
    fun aDiscardedOwnerCannotWriteAgain() = runTest(dispatcher) {
        val store = FakeStore()
        val coordinator = PlannerDraftCoordinator(store)
        val owner = Any()
        coordinator.claim("route", owner)
        coordinator.save("route", owner, "draft")

        coordinator.discard("route", owner)
        coordinator.save("route", owner, "resurrected")

        assertNull(store.disk["route"])
    }

    @Test
    fun aRecreatedActivityUsesTheProcessCoordinatorSoItsClearWaitsForTheOldSave() = runTest(dispatcher) {
        PlannerDraftCoordinator.resetProcessInstanceForTest()
        val store = FakeStore().apply {
            uncancellableWrites = true
            gate = CompletableDeferred()
            writing = CompletableDeferred()
        }
        var created = 0
        val beforeRotation = PlannerDraftCoordinator.forProcess {
            created += 1
            store
        }
        val afterRotation = PlannerDraftCoordinator.forProcess {
            created += 1
            store
        }
        assertTrue(beforeRotation === afterRotation)
        assertEquals(1, created)

        val oldScreen = Any()
        val newScreen = Any()
        beforeRotation.claim("route", oldScreen)
        val oldSave = launch { beforeRotation.save("route", oldScreen, "abandoned draft") }
        runCurrent()
        assertTrue(store.writing!!.isCompleted)
        oldSave.cancel()

        // The recreated Activity's screen takes the slot and clears it (its form is empty).
        afterRotation.claim("route", newScreen)
        val newClear = launch { afterRotation.clear("route", newScreen) }
        runCurrent()
        assertFalse(newClear.isCompleted, "the new clear must wait for the write that is already in progress")

        store.gate!!.complete(Unit)
        runCurrent()

        assertTrue(newClear.isCompleted)
        assertNull(store.disk["route"], "the abandoned draft must not survive the recreated Activity's clear")
        PlannerDraftCoordinator.resetProcessInstanceForTest()
    }
}
