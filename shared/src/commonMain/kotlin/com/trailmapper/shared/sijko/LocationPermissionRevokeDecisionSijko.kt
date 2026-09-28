/**
 * Job: Decide whether debug self-revocation of location permission is available and meaningful.
 *
 */
package com.trailmapper.shared.sijko

object LocationPermissionRevokeDecisionSijko {
    fun status(
        supportsSelfRevocation: Boolean,
        hasForegroundLocationPermission: Boolean,
    ): LocationPermissionRevokeStatus {
        return when {
            !supportsSelfRevocation -> LocationPermissionRevokeStatus.UnsupportedPlatform
            !hasForegroundLocationPermission -> LocationPermissionRevokeStatus.NoForegroundPermissionGranted
            else -> LocationPermissionRevokeStatus.Available
        }
    }

    fun canRevoke(status: LocationPermissionRevokeStatus): Boolean {
        return status == LocationPermissionRevokeStatus.Available
    }
}
