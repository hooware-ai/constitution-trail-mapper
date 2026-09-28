/**
 * Job: Verify debug revoke availability for unsupported, already-revoked, and granted-permission states.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class LocationPermissionRevokeDecisionSijkoTest {
    @Test
    fun unsupportedPlatformTakesPrecedence() {
        assertEquals(
            LocationPermissionRevokeStatus.UnsupportedPlatform,
            LocationPermissionRevokeDecisionSijko.status(
                supportsSelfRevocation = false,
                hasForegroundLocationPermission = true,
            ),
        )
        assertEquals(
            LocationPermissionRevokeStatus.UnsupportedPlatform,
            LocationPermissionRevokeDecisionSijko.status(
                supportsSelfRevocation = false,
                hasForegroundLocationPermission = false,
            ),
        )
    }

    @Test
    fun supportedPlatformRequiresAnExistingForegroundPermissionToRevoke() {
        assertEquals(
            LocationPermissionRevokeStatus.NoForegroundPermissionGranted,
            LocationPermissionRevokeDecisionSijko.status(
                supportsSelfRevocation = true,
                hasForegroundLocationPermission = false,
            ),
        )
        assertEquals(
            LocationPermissionRevokeStatus.Available,
            LocationPermissionRevokeDecisionSijko.status(
                supportsSelfRevocation = true,
                hasForegroundLocationPermission = true,
            ),
        )
    }

    @Test
    fun onlyAvailableStatusCanRevoke() {
        assertTrue(LocationPermissionRevokeDecisionSijko.canRevoke(LocationPermissionRevokeStatus.Available))
        assertFalse(
            LocationPermissionRevokeDecisionSijko.canRevoke(
                LocationPermissionRevokeStatus.UnsupportedPlatform,
            ),
        )
        assertFalse(
            LocationPermissionRevokeDecisionSijko.canRevoke(
                LocationPermissionRevokeStatus.NoForegroundPermissionGranted,
            ),
        )
    }
}
