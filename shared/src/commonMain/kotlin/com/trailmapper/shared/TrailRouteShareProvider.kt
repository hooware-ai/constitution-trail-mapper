/**
 * Job: Define the shared platform boundary for sharing saved trail routes with other people.
 *
 */
package com.trailmapper.shared

interface TrailRouteShareProvider {
    val isAvailable: Boolean

    fun share(savedRoute: SavedTrailRoute)
}
