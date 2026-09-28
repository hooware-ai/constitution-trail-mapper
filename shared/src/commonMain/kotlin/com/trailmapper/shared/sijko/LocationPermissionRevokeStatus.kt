/**
 * Job: Name the debug states for whether location permissions can be self-revoked.
 *
 */
package com.trailmapper.shared.sijko

enum class LocationPermissionRevokeStatus {
    Available,
    UnsupportedPlatform,
    NoForegroundPermissionGranted,
}
