/**
 * Job: Name the route endpoint that should receive a current-location or map-picked address.
 *
 */
package com.trailmapper.shared.sijko

enum class RouteEndpointTarget(val label: String) {
    Start("Start"),
    Destination("Destination"),
}
