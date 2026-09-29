/**
 * Job: Encode planner drafts and decode only those that are readable and recent enough to restore.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.ExercisePlannerDraft
import com.trailmapper.shared.RoutePlannerDraft
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

object PlannerDraftJsonSijko {
    const val ROUTE_SLOT = "route"
    const val EXERCISE_SLOT = "exercise"

    /** A form left this long ago is not what the rider expects to find, and is not kept. */
    const val MAXIMUM_AGE_MILLIS = 24L * 60 * 60 * 1000

    private val json = Json {
        encodeDefaults = true
        explicitNulls = true
        ignoreUnknownKeys = true
    }

    fun encodeRoute(draft: RoutePlannerDraft): String = json.encodeToString(draft)

    fun encodeExercise(draft: ExercisePlannerDraft): String = json.encodeToString(draft)

    fun decodeRoute(
        serialized: String,
        nowEpochMillis: Long,
    ): RoutePlannerDraft? = runCatching { json.decodeFromString<RoutePlannerDraft>(serialized) }
        .getOrNull()
        ?.takeIf { draft -> isFresh(draft.savedAtEpochMillis, nowEpochMillis) }

    fun decodeExercise(
        serialized: String,
        nowEpochMillis: Long,
    ): ExercisePlannerDraft? = runCatching { json.decodeFromString<ExercisePlannerDraft>(serialized) }
        .getOrNull()
        ?.takeIf { draft -> isFresh(draft.savedAtEpochMillis, nowEpochMillis) }

    fun isFresh(
        savedAtEpochMillis: Long,
        nowEpochMillis: Long,
    ): Boolean = nowEpochMillis - savedAtEpochMillis in 0..MAXIMUM_AGE_MILLIS
}
