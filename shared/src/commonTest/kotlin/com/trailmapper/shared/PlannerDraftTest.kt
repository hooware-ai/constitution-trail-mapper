/**
 * Job: Verify planner drafts round-trip, expire, and restore only onto a form that has not been started.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.ExerciseRouteResult
import com.trailmapper.shared.routing.ExerciseRouteStatus
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.PlannerDraftJsonSijko
import com.trailmapper.shared.sijko.RouteEndpointTarget
import com.trailmapper.shared.sijko.RouteEndpoints
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain

@OptIn(ExperimentalCoroutinesApi::class)
class PlannerDraftTest {
    private val dispatcher = StandardTestDispatcher()
    private val now = 1_000_000_000L
    private val start = MapPoint(40.49, -88.98)
    private val destination = MapPoint(40.51, -88.95)

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun routeDraftRoundTripsWithItsRoute() {
        val draft = RoutePlannerDraft(
            savedAtEpochMillis = now,
            endpoints = RouteEndpoints("Home", "Library", start, destination),
            routeLayers = RouteLayerDefaultsSijko.defaultSelection().copy(proposedTrails = true),
            lastRoute = route(),
        )

        assertEquals(draft, PlannerDraftJsonSijko.decodeRoute(PlannerDraftJsonSijko.encodeRoute(draft), now))
    }

    @Test
    fun exerciseDraftRoundTripsWithItsResult() {
        val draft = ExercisePlannerDraft(
            savedAtEpochMillis = now,
            startAddress = "Home",
            startPoint = start,
            targetMilesText = "5",
            proposedTrailsEnabled = false,
            result = ExerciseRouteResult(route(), ExerciseRouteStatus.Exact, "Loop found", "key", "38 min", 12.0, 0.0, 50.0),
        )

        assertEquals(draft, PlannerDraftJsonSijko.decodeExercise(PlannerDraftJsonSijko.encodeExercise(draft), now))
    }

    @Test
    fun unreadableOrExpiredDraftsAreIgnored() {
        val draft = RoutePlannerDraft(now, RouteEndpoints("Home", "", start, null), RouteLayerDefaultsSijko.defaultSelection())
        val serialized = PlannerDraftJsonSijko.encodeRoute(draft)

        assertNull(PlannerDraftJsonSijko.decodeRoute("not json", now))
        assertNull(PlannerDraftJsonSijko.decodeRoute(serialized, now + PlannerDraftJsonSijko.MAXIMUM_AGE_MILLIS + 1))
        assertNull(PlannerDraftJsonSijko.decodeRoute(serialized, now - 1)) // a draft from the future is not trusted
        assertEquals(draft, PlannerDraftJsonSijko.decodeRoute(serialized, now + PlannerDraftJsonSijko.MAXIMUM_AGE_MILLIS))
    }

    @Test
    fun anEmptyFormMakesNoDraft() {
        assertNull(RoutePlannerViewModel().toDraft(now))
        assertNull(ExerciseRoutePlannerViewModel(NoCompletedExerciseSessionStore).toDraft(now))
    }

    @Test
    fun aRestoredRouteFormComesBackAndPreparingDoesNotBlankIt() = runTest(dispatcher) {
        val draft = RoutePlannerDraft(
            savedAtEpochMillis = now,
            endpoints = RouteEndpoints("Home", "Library", start, destination),
            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
            lastRoute = route(),
        )
        val viewModel = RoutePlannerViewModel()

        viewModel.restoreDraft(draft)
        viewModel.prepareRoute(null)
        runCurrent()

        val state = viewModel.uiState.value
        assertEquals(draft.endpoints, state.endpoints)
        assertEquals(draft.lastRoute, state.lastRoute)
        assertNull(state.routeNotice)
    }

    @Test
    fun aLiveRouteFormIsNeverOverwrittenByADraft() {
        val viewModel = RoutePlannerViewModel()
        viewModel.prepareRoute(null)
        viewModel.updateEndpointText(RouteEndpointTarget.Start, "Typed now", NoAddressAutocompleteProvider)

        viewModel.restoreDraft(
            RoutePlannerDraft(now, RouteEndpoints("Old", "Old too", start, destination), RouteLayerDefaultsSijko.defaultSelection()),
        )

        assertEquals("Typed now", viewModel.uiState.value.endpoints.start)
    }

    @Test
    fun aRestoredExerciseFormComesBackWithoutReopeningItsMap() {
        val draft = ExercisePlannerDraft(
            savedAtEpochMillis = now,
            startAddress = "Home",
            startPoint = start,
            targetMilesText = "5",
            proposedTrailsEnabled = true,
            result = ExerciseRouteResult(route(), ExerciseRouteStatus.Closest, "Loop", "key", "38 min", 200.0, 0.0, 0.0),
        )
        val viewModel = ExerciseRoutePlannerViewModel(NoCompletedExerciseSessionStore)

        viewModel.restoreDraft(draft)

        val state = viewModel.uiState.value
        assertEquals("Home", state.startAddress)
        assertEquals(start, state.startPoint)
        assertEquals("5", state.targetMilesText)
        assertTrue(state.proposedTrailsEnabled)
        assertEquals(draft.result, state.result)
        assertFalse(state.resultAwaitingMap)
    }

    @Test
    fun aLiveExerciseFormIsNeverOverwrittenByADraft() {
        val viewModel = ExerciseRoutePlannerViewModel(NoCompletedExerciseSessionStore)
        viewModel.setTargetMilesText("8")

        viewModel.restoreDraft(ExercisePlannerDraft(now, "Old", start, "3", false))

        assertEquals("8", viewModel.uiState.value.targetMilesText)
        assertEquals("", viewModel.uiState.value.startAddress)
    }

    @Test
    fun leavingThePlannerRunsTheDiscardHookOnce() {
        val viewModel = RoutePlannerViewModel()
        var discards = 0
        viewModel.setDiscardHook { discards += 1 }

        // The platform calls onCleared, which discards, only when the entry is really popped.
        viewModel.discard()
        viewModel.discard()

        assertEquals(1, discards)
    }

    private fun route() = TrailRoute(
        totalDistanceMeters = 1_609.0,
        ordinaryAccessDistanceMeters = 0.0,
        totalCost = 1_609.0,
        kind = TrailRouteKind.Navigation,
    )
}
