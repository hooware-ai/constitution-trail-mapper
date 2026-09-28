/**
 * Job: Generate a stable default title for a newly saved trail route.
 *
 */
package com.trailmapper.shared.sijko

object SavedTrailRouteTitleSijko {
    fun titleFor(savedRouteCount: Int): String {
        return "Saved route ${savedRouteCount + 1}"
    }
}
