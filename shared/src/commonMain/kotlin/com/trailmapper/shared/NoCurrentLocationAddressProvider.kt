/**
 * Job: Provide a safe fallback location provider for previews or platforms without current-location support.
 *
 */
package com.trailmapper.shared

object NoCurrentLocationAddressProvider : CurrentLocationAddressProvider {
    override fun shouldExplainCurrentLocationAccess(): Boolean {
        return false
    }

    override suspend fun getCurrentAddress(): CurrentLocationAddressResult {
        return CurrentLocationAddressResult.LocationUnavailable
    }
}
