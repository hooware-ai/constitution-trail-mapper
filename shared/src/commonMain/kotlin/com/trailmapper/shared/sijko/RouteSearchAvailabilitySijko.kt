/**
 * Job: Decide whether the route search action has enough endpoint information to run.
 *
 */
package com.trailmapper.shared.sijko

object RouteSearchAvailabilitySijko {
    fun canSearch(endpoints: RouteEndpoints): Boolean {
        return endpoints.start.isNotBlank() && endpoints.destination.isNotBlank()
    }
}
