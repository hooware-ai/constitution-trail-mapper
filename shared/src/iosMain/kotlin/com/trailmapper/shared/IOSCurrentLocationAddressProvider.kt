/**
 * Job: Implement current-location address lookup for iOS using CoreLocation and CLGeocoder.
 *
 */
package com.trailmapper.shared

import com.trailmapper.shared.sijko.MapPoint
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.useContents
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import platform.CoreLocation.CLAuthorizationStatus
import platform.CoreLocation.CLGeocoder
import platform.CoreLocation.CLLocation
import platform.CoreLocation.CLLocationManager
import platform.CoreLocation.CLLocationManagerDelegateProtocol
import platform.CoreLocation.CLPlacemark
import platform.CoreLocation.kCLAuthorizationStatusAuthorizedAlways
import platform.CoreLocation.kCLAuthorizationStatusAuthorizedWhenInUse
import platform.CoreLocation.kCLAuthorizationStatusDenied
import platform.CoreLocation.kCLAuthorizationStatusNotDetermined
import platform.CoreLocation.kCLAuthorizationStatusRestricted
import platform.CoreLocation.kCLLocationAccuracyBest
import platform.Foundation.NSError
import platform.darwin.NSObject
import kotlin.coroutines.resume

class IOSCurrentLocationAddressProvider : CurrentLocationAddressProvider {
    private val locationManager = CLLocationManager()
    private var activeDelegate: CLLocationManagerDelegateProtocol? = null

    override fun shouldExplainCurrentLocationAccess(): Boolean {
        return !authorizationStatus().isAuthorized
    }

    override suspend fun getCurrentAddress(): CurrentLocationAddressResult {
        if (!CLLocationManager.locationServicesEnabled()) {
            return CurrentLocationAddressResult.LocationServicesDisabled
        }

        if (!requestAuthorizationIfNeeded()) {
            return CurrentLocationAddressResult.PermissionDenied
        }

        val location = withTimeoutOrNull(LOCATION_TIMEOUT_MILLIS) {
            requestCurrentLocation()
        } ?: return CurrentLocationAddressResult.LocationUnavailable

        val address = reverseGeocode(location)
        return CurrentLocationAddressResult.Success(
            address = address,
            point = location.mapPoint(),
        )
    }

    private suspend fun requestAuthorizationIfNeeded(): Boolean {
        val currentStatus = authorizationStatus()
        return when {
            currentStatus.isAuthorized -> true
            currentStatus.isDeniedOrRestricted -> false
            currentStatus == kCLAuthorizationStatusNotDetermined -> requestWhenInUseAuthorization()
            else -> false
        }
    }

    private suspend fun requestWhenInUseAuthorization(): Boolean {
        return suspendCancellableCoroutine { continuation ->
            var completed = false

            fun complete(status: CLAuthorizationStatus) {
                if (completed || status == kCLAuthorizationStatusNotDetermined) {
                    return
                }

                completed = true
                clearDelegate()
                continuation.resume(status.isAuthorized)
            }

            val delegate = object : NSObject(), CLLocationManagerDelegateProtocol {
                override fun locationManagerDidChangeAuthorization(manager: CLLocationManager) {
                    complete(authorizationStatus())
                }

                @Suppress("DEPRECATION")
                override fun locationManager(
                    manager: CLLocationManager,
                    didChangeAuthorizationStatus: CLAuthorizationStatus,
                ) {
                    complete(didChangeAuthorizationStatus)
                }
            }

            activeDelegate = delegate
            locationManager.delegate = delegate
            continuation.invokeOnCancellation {
                completed = true
                clearDelegate()
            }
            locationManager.requestWhenInUseAuthorization()
        }
    }

    private suspend fun requestCurrentLocation(): CLLocation? {
        return suspendCancellableCoroutine { continuation ->
            var completed = false

            fun complete(location: CLLocation?) {
                if (completed) {
                    return
                }

                completed = true
                clearDelegate()
                continuation.resume(location)
            }

            val delegate = object : NSObject(), CLLocationManagerDelegateProtocol {
                override fun locationManager(
                    manager: CLLocationManager,
                    didUpdateLocations: List<*>,
                ) {
                    complete(didUpdateLocations.lastOrNull() as? CLLocation)
                }

                override fun locationManager(
                    manager: CLLocationManager,
                    didFailWithError: NSError,
                ) {
                    complete(null)
                }
            }

            activeDelegate = delegate
            locationManager.delegate = delegate
            locationManager.desiredAccuracy = kCLLocationAccuracyBest
            continuation.invokeOnCancellation {
                completed = true
                clearDelegate()
            }
            locationManager.requestLocation()
        }
    }

    private suspend fun reverseGeocode(location: CLLocation): String {
        val placemark = suspendCancellableCoroutine<CLPlacemark?> { continuation ->
            CLGeocoder().reverseGeocodeLocation(location) { placemarks, _ ->
                continuation.resume(placemarks?.firstOrNull() as? CLPlacemark)
            }
        }

        return placemark?.formattedAddress()?.takeIf { it.isNotBlank() }
            ?: location.coordinateText()
    }

    private fun CLPlacemark.formattedAddress(): String {
        val street = listOfNotNull(subThoroughfare, thoroughfare)
            .joinToString(" ")
            .ifBlank { name.orEmpty() }
        val cityStateZip = listOfNotNull(locality, administrativeArea, postalCode)
            .joinToString(", ")

        return listOf(street, cityStateZip, country.orEmpty())
            .filter { it.isNotBlank() }
            .joinToString(", ")
    }

    @OptIn(ExperimentalForeignApi::class)
    private fun CLLocation.coordinateText(): String {
        return coordinate.useContents {
            "$latitude, $longitude"
        }
    }

    @OptIn(ExperimentalForeignApi::class)
    private fun CLLocation.mapPoint(): MapPoint {
        return coordinate.useContents {
            MapPoint(
                latitude = latitude,
                longitude = longitude,
            )
        }
    }

    private fun authorizationStatus(): CLAuthorizationStatus {
        return CLLocationManager.authorizationStatus()
    }

    private fun clearDelegate() {
        locationManager.delegate = null
        activeDelegate = null
    }

    private val CLAuthorizationStatus.isAuthorized: Boolean
        get() = this == kCLAuthorizationStatusAuthorizedWhenInUse ||
            this == kCLAuthorizationStatusAuthorizedAlways

    private val CLAuthorizationStatus.isDeniedOrRestricted: Boolean
        get() = this == kCLAuthorizationStatusDenied ||
            this == kCLAuthorizationStatusRestricted

    private companion object {
        const val LOCATION_TIMEOUT_MILLIS = 20_000L
    }
}
