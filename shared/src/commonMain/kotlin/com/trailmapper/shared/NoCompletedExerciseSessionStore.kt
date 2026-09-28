/**
 * Job: Provide an empty exercise-history store when a platform has no persistence implementation.
 *
 */
package com.trailmapper.shared

object NoCompletedExerciseSessionStore : CompletedExerciseSessionStore {
    override suspend fun completedSessions(): List<CompletedExerciseSession> = emptyList()

    override suspend fun recordCompletedSession(
        session: CompletedExerciseSession,
    ): CompletedExerciseSession = session
}
