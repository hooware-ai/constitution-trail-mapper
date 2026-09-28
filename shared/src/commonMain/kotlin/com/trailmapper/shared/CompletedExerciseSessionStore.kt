/**
 * Job: Define the platform persistence boundary for completed exercise navigation history.
 *
 */
package com.trailmapper.shared

interface CompletedExerciseSessionStore {
    suspend fun completedSessions(): List<CompletedExerciseSession>

    suspend fun recordCompletedSession(session: CompletedExerciseSession): CompletedExerciseSession
}
