/**
 * Job: Define the shared platform boundary for turning the device's current location into an address.
 *
 */
package com.trailmapper.shared

interface CurrentLocationAddressProvider {
    fun shouldExplainCurrentLocationAccess(): Boolean

    suspend fun getCurrentAddress(): CurrentLocationAddressResult
}
