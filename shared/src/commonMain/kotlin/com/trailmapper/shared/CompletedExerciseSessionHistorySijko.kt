/**
 * Job: Normalize completed exercise history into newest-first, bounded, unique session data.
 *
 */
package com.trailmapper.shared

object CompletedExerciseSessionHistorySijko {
    const val MAX_SESSION_COUNT = 100

    fun newestFirst(sessions: List<CompletedExerciseSession>): List<CompletedExerciseSession> {
        return sessions
            .sortedByDescending(CompletedExerciseSession::completedAtEpochMillis)
            .distinctBy(CompletedExerciseSession::id)
            .take(MAX_SESSION_COUNT)
    }

    fun withRecordedSession(
        existingSessions: List<CompletedExerciseSession>,
        session: CompletedExerciseSession,
    ): List<CompletedExerciseSession> {
        return newestFirst(
            listOf(session) + existingSessions.filterNot { it.id == session.id },
        )
    }
}
