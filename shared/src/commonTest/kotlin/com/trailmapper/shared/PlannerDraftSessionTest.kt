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
        val session = PlannerDraftSession("route", store, recreated = true, restore = {}, settle = { settled += 1 })

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
        val session = PlannerDraftSession("route", store, recreated = false, restore = { error("must not restore") }, settle = { settled += 1 })

        session.restoreIfRecreated()

        assertEquals(0, loads)
        assertEquals(1, settled)
        assertTrue(session.ready)
    }

    // ---- 4: discard ownership and ordered storage ----

    @Test
    fun aLateDiscardFromAnOlderVisitDoesNotTouchANewerVisitsDraft() {
        val older = Any()
        val newer = Any()
        PlannerDraftOwnership.claim("route", older)
        PlannerDraftOwnership.claim("route", newer)

        assertFalse(PlannerDraftOwnership.release("route", older))
        assertTrue(PlannerDraftOwnership.release("route", newer))
        assertFalse(PlannerDraftOwnership.release("route", newer))
    }

    @Test
    fun aClearWaitsForASaveThatIsAlreadyWritingSoTheDraftStaysCleared() = runTest(dispatcher) {
        val writing = CompletableDeferred<Unit>()
        val finishWrite = CompletableDeferred<Unit>()
        val disk = mutableMapOf<String, String>()
        val store = SerializedPlannerDraftStore(object : PlannerDraftStore {
            override suspend fun load(slot: String): String? = disk[slot]

            override suspend fun save(slot: String, serialized: String) {
                // A write that has begun cannot be cancelled part way, like a blocking commit.
                withContext(NonCancellable) {
                    writing.complete(Unit)
                    finishWrite.await()
                    disk[slot] = serialized
                }
            }

            override suspend fun clear(slot: String) {
                disk.remove(slot)
            }
        })

        val save = launch { store.save("route", "abandoned draft") }
        runCurrent()
        assertTrue(writing.isCompleted)
        save.cancel()
        val clear = launch { store.clear("route") }
        runCurrent()
        assertFalse(clear.isCompleted, "clear must wait for the write already in progress")

        finishWrite.complete(Unit)
        runCurrent()

        assertTrue(clear.isCompleted)
        assertNull(disk["route"], "the cleared draft must not be revived by the cancelled save")
    }

    @Test
    fun aSaveCancelledBeforeItsTurnNeverWrites() = runTest(dispatcher) {
        val release = CompletableDeferred<Unit>()
        val disk = mutableMapOf<String, String>()
        val store = SerializedPlannerDraftStore(object : PlannerDraftStore {
            override suspend fun load(slot: String): String? {
                release.await()
                return disk[slot]
            }

            override suspend fun save(slot: String, serialized: String) {
                disk[slot] = serialized
            }

            override suspend fun clear(slot: String) {
                disk.remove(slot)
            }
        })

        val busy = launch { store.load("route") }
        runCurrent()
        val waitingSave = launch { store.save("route", "queued draft") }
        runCurrent()
        waitingSave.cancel()
        release.complete(Unit)
        runCurrent()

        assertTrue(busy.isCompleted)
        assertNull(disk["route"])
    }
}
