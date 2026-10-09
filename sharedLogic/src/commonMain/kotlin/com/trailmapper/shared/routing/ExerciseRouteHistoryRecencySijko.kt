/**
 * Job: Convert completed-ride age into the fading weight used by exercise-route novelty scoring.
 *
 */
package com.trailmapper.shared.routing

import kotlin.math.max
import kotlin.math.pow

object ExerciseRouteHistoryRecencySijko {
    fun weight(
        completedAtEpochMillis: Long,
        nowEpochMillis: Long,
    ): Double {
        val ageMillis = max(0L, nowEpochMillis - completedAtEpochMillis)
        return 0.5.pow(ageMillis.toDouble() / HalfLifeMillis)
    }

    private const val HalfLifeMillis = 21.0 * 24.0 * 60.0 * 60.0 * 1_000.0
}
