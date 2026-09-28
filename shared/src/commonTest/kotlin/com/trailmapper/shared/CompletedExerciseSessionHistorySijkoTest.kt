/**
 * Job: Verify completed exercise history ordering, deduplication, retention, and JSON compatibility.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.routing.TrailRouteTraversalEdge
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class CompletedExerciseSessionHistorySijkoTest {
    @Test
    fun ordersNewestFirstAndKeepsTheRecordedDuplicate() {
        val existing = session(id = "same", completedAt = 100)
        val replacement = session(id = "same", completedAt = 300)
        val older = session(id = "older", completedAt = 200)

        assertEquals(
            expected = listOf(replacement, older),
            actual = CompletedExerciseSessionHistorySijko.withRecordedSession(
                existingSessions = listOf(existing, older),
                session = replacement,
            ),
        )
    }

    @Test
    fun retainsOnlyTheHundredNewestSessions() {
        val sessions = (0..CompletedExerciseSessionHistorySijko.MAX_SESSION_COUNT).map { index ->
            session(id = "session-$index", completedAt = index.toLong())
        }

        val normalized = CompletedExerciseSessionHistorySijko.newestFirst(sessions)

        assertEquals(CompletedExerciseSessionHistorySijko.MAX_SESSION_COUNT, normalized.size)
        assertEquals("session-100", normalized.first().id)
        assertEquals("session-1", normalized.last().id)
    }

    @Test
    fun roundTripsCompletedSessionsAndAcceptsLegacyTraversalEdgeDefaults() {
        val sessions = listOf(session(id = "session-1", completedAt = 42))
        val legacyJson = """
            [{
              "id":"session-1",
              "routeKey":"route-1",
              "completedAtEpochMillis":42,
              "completedDistanceMeters":1609.344,
              "traversalEdges":[{"key":"edge-1","distanceMeters":100.0}]
            }]
        """.trimIndent()

        assertEquals(
            expected = sessions,
            actual = TrailMapperPersistenceJsonSijko.decodeCompletedExerciseSessions(
                TrailMapperPersistenceJsonSijko.encodeCompletedExerciseSessions(sessions),
            ),
        )
        assertEquals(0.0, TrailMapperPersistenceJsonSijko.decodeCompletedExerciseSessions(legacyJson)
            ?.single()?.traversalEdges?.single()?.ordinaryAccessDistanceMeters)
    }

    @Test
    fun acceptsEmptyHistoryAndRejectsMalformedHistory() {
        assertEquals(emptyList(), TrailMapperPersistenceJsonSijko.decodeCompletedExerciseSessions("[]"))
        assertNull(TrailMapperPersistenceJsonSijko.decodeCompletedExerciseSessions("not-json"))
    }

    private fun session(id: String, completedAt: Long): CompletedExerciseSession {
        return CompletedExerciseSession(
            id = id,
            routeKey = "route-$id",
            completedAtEpochMillis = completedAt,
            completedDistanceMeters = 1609.344,
            traversalEdges = listOf(
                TrailRouteTraversalEdge(key = "edge-$id", distanceMeters = 100.0),
            ),
        )
    }
}
