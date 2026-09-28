/**
 * Job: Persist completed exercise navigation history in Android SharedPreferences.
 *
 */
package com.trailmapper.android

import android.content.Context
import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.CompletedExerciseSessionHistorySijko
import com.trailmapper.shared.CompletedExerciseSessionStore
import com.trailmapper.shared.TrailMapperPersistenceJsonSijko
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class AndroidCompletedExerciseSessionStore(
    context: Context,
) : CompletedExerciseSessionStore {
    private val preferences by lazy {
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    }
    private val operationMutex = Mutex()

    override suspend fun completedSessions(): List<CompletedExerciseSession> = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            readSessions()
        }
    }

    override suspend fun recordCompletedSession(
        session: CompletedExerciseSession,
    ): CompletedExerciseSession = operationMutex.withLock {
        withContext(Dispatchers.IO) {
            val updatedSessions = CompletedExerciseSessionHistorySijko.withRecordedSession(
                existingSessions = readSessions(),
                session = session,
            )
            check(writeSessions(updatedSessions)) {
                "Unable to persist completed exercise session."
            }
            session
        }
    }

    private fun readSessions(): List<CompletedExerciseSession> {
        val serializedSessions = preferences.getString(KEY_SESSIONS, null) ?: return emptyList()
        val sessions = TrailMapperPersistenceJsonSijko.decodeCompletedExerciseSessions(serializedSessions)
            ?: throw IllegalStateException("Malformed completed exercise sessions.")
        return CompletedExerciseSessionHistorySijko.newestFirst(sessions)
    }

    private fun writeSessions(sessions: List<CompletedExerciseSession>): Boolean {
        return preferences.edit()
            .putString(KEY_SESSIONS, TrailMapperPersistenceJsonSijko.encodeCompletedExerciseSessions(sessions))
            .commit()
    }

    private companion object {
        const val PREFERENCES_NAME = "trail_mapper_completed_exercise_sessions"
        const val KEY_SESSIONS = "sessions"
    }
}
