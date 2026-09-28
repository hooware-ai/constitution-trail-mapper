/**
 * Job: Generate a stable default title for a newly saved exercise loop.
 *
 */
package com.trailmapper.shared.sijko

object SavedExerciseRouteTitleSijko {
    fun titleFor(savedExerciseRouteCount: Int): String {
        return "Exercise route ${savedExerciseRouteCount + 1}"
    }
}
