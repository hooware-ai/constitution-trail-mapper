/**
 * Job: Decide which route endpoint may use the device's current location shortcut.
 *
 */
package com.trailmapper.shared.sijko

object CurrentLocationEndpointAvailabilitySijko {
    fun isAvailableFor(target: RouteEndpointTarget): Boolean {
        return target == RouteEndpointTarget.Start
    }
}
