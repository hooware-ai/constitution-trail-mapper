/**
 * Job: Decide whether the app should explain current-location access before requesting permission.
 *
 */
package com.trailmapper.shared.sijko

object CurrentLocationPromptSijko {
    fun shouldExplain(hasForegroundLocationPermission: Boolean): Boolean {
        return !hasForegroundLocationPermission
    }
}
