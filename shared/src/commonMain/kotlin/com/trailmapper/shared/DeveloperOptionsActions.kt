/**
 * Job: Define the shared debug-actions contract that platform app entry points can optionally provide.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.LocationPermissionRevokeDecisionSijko
import com.trailmapper.shared.sijko.LocationPermissionRevokeStatus

interface DeveloperOptionsActions {
    val locationPermissionRevokeStatus: LocationPermissionRevokeStatus

    val canRevokeLocationPermissions: Boolean
        get() = LocationPermissionRevokeDecisionSijko.canRevoke(locationPermissionRevokeStatus)

    fun openAppSettings()

    fun revokeLocationPermissions()
}
