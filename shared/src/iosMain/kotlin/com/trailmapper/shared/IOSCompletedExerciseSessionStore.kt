/**
 * Job: Persist completed exercise navigation history in iOS user defaults.
 *
 */
package com.trailmapper.shared

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import platform.Foundation.NSUserDefaults

class IOSCompletedExerciseSessionStore : CompletedExerciseSessionStore {
    private val userDefaults = NSUserDefaults.standardUserDefaults
    private val operationMutex = Mutex()

    override suspend fun completedSessions(): List<CompletedExerciseSession> = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            readSessions()
        }
    }

    override suspend fun recordCompletedSession(
        session: CompletedExerciseSession,
    ): CompletedExerciseSession = operationMutex.withLock {
        withContext(Dispatchers.Default) {
            val updatedSessions = CompletedExerciseSessionHistorySijko.withRecordedSession(
                existingSessions = readSessions(),
                session = session,
            )
            writeSessions(updatedSessions)
            session
        }
    }

    private fun readSessions(): List<CompletedExerciseSession> {
        val serializedSessions = userDefaults.stringForKey(KEY_SESSIONS) ?: return emptyList()
        val sessions = TrailMapperPersistenceJsonSijko.decodeCompletedExerciseSessions(serializedSessions)
            ?: throw IllegalStateException("Malformed completed exercise sessions.")
        return CompletedExerciseSessionHistorySijko.newestFirst(sessions)
    }

    private fun writeSessions(sessions: List<CompletedExerciseSession>) {
        userDefaults.setObject(
            TrailMapperPersistenceJsonSijko.encodeCompletedExerciseSessions(sessions),
            forKey = KEY_SESSIONS,
        )
    }

    private companion object {
        const val KEY_SESSIONS = "trail_mapper_completed_exercise_sessions"
    }
}
