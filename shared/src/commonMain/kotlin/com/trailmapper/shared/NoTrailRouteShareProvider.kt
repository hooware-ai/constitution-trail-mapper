/**
 * Job: Keep saved-route sharing disabled on platforms without a share-sheet implementation.
 *
 */
package com.trailmapper.shared

object NoTrailRouteShareProvider : TrailRouteShareProvider {
    override val isAvailable: Boolean = false

    override fun share(savedRoute: SavedTrailRoute) = Unit
}
