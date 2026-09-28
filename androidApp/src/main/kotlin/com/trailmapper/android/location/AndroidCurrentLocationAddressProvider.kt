/**
 * Job: Implement current-location address lookup for Android using permissions, Play Services, and Geocoder.
 *
 */
package com.trailmapper.android.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Address
import android.location.Geocoder
import android.location.Location
import android.os.Build
import androidx.activity.result.IntentSenderRequest
import androidx.core.content.ContextCompat
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import com.trailmapper.shared.CurrentLocationAddressProvider
import com.trailmapper.shared.CurrentLocationAddressResult
import com.trailmapper.shared.sijko.CurrentLocationPromptSijko
import com.trailmapper.shared.sijko.ForegroundLocationGrantSijko
import com.trailmapper.shared.sijko.MapPoint
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

class AndroidCurrentLocationAddressProvider(
    private val context: Context,
    private val requestLocationPermission: suspend () -> Boolean,
    private val resolveLocationSettings: suspend (IntentSenderRequest) -> Boolean,
) : CurrentLocationAddressProvider {
    private val fusedLocationClient = LocationServices.getFusedLocationProviderClient(context)
    private val settingsClient = LocationServices.getSettingsClient(context)

    override fun shouldExplainCurrentLocationAccess(): Boolean {
        return CurrentLocationPromptSijko.shouldExplain(hasForegroundLocationPermission())
    }

    override suspend fun getCurrentAddress(): CurrentLocationAddressResult {
        if (!hasForegroundLocationPermission() && !requestLocationPermission()) {
            return CurrentLocationAddressResult.PermissionDenied
        }

        if (!ensureLocationSettings()) {
            return CurrentLocationAddressResult.LocationServicesDisabled
        }

        val location = try {
            withTimeoutOrNull(LOCATION_TIMEOUT_MILLIS) {
                currentLocation()
            }
        } catch (exception: SecurityException) {
            return CurrentLocationAddressResult.PermissionDenied
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            return CurrentLocationAddressResult.Error(
                exception.message ?: "Unable to get current location.",
            )
        } ?: return CurrentLocationAddressResult.LocationUnavailable

        val address = reverseGeocode(location)
        return CurrentLocationAddressResult.Success(
            address = address,
            point = MapPoint(
                latitude = location.latitude,
                longitude = location.longitude,
            ),
        )
    }

    private fun hasForegroundLocationPermission(): Boolean {
        return ForegroundLocationGrantSijko.isGranted(
            fineGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_FINE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED,
            coarseGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED,
        )
    }

    private suspend fun ensureLocationSettings(): Boolean {
        val locationRequest = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            LOCATION_REQUEST_INTERVAL_MILLIS,
        )
            .setMinUpdateIntervalMillis(LOCATION_REQUEST_MIN_INTERVAL_MILLIS)
            .build()
        val settingsRequest = LocationSettingsRequest.Builder()
            .addLocationRequest(locationRequest)
            .build()

        return try {
            settingsClient.checkLocationSettings(settingsRequest).await()
            true
        } catch (exception: ResolvableApiException) {
            val request = IntentSenderRequest.Builder(exception.resolution).build()
            resolveLocationSettings(request)
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            false
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun currentLocation(): Location? {
        val cancellationTokenSource = CancellationTokenSource()
        return try {
            fusedLocationClient
                .getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellationTokenSource.token)
                .await()
                ?: fusedLocationClient.lastLocation.await()
        } finally {
            cancellationTokenSource.cancel()
        }
    }

    private suspend fun reverseGeocode(location: Location): String {
        if (!Geocoder.isPresent()) {
            return location.coordinateText()
        }

        val addresses = withContext(Dispatchers.IO) {
            val geocoder = Geocoder(context, Locale.getDefault())
            geocoder.getFromLocationCompat(
                latitude = location.latitude,
                longitude = location.longitude,
                maxResults = 1,
            )
        }

        return addresses
            .firstOrNull()
            ?.getAddressLine(0)
            ?.takeIf { it.isNotBlank() }
            ?: location.coordinateText()
    }

    @Suppress("DEPRECATION")
    private suspend fun Geocoder.getFromLocationCompat(
        latitude: Double,
        longitude: Double,
        maxResults: Int,
    ): List<Address> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            suspendCancellableCoroutine { continuation ->
                getFromLocation(
                    latitude,
                    longitude,
                    maxResults,
                    object : Geocoder.GeocodeListener {
                        override fun onGeocode(addresses: MutableList<Address>) {
                            if (continuation.isActive) {
                                continuation.resume(addresses)
                            }
                        }

                        override fun onError(errorMessage: String?) {
                            if (continuation.isActive) {
                                continuation.resume(emptyList())
                            }
                        }
                    },
                )
            }
        } else {
            getFromLocation(latitude, longitude, maxResults).orEmpty()
        }
    }

    private fun Location.coordinateText(): String {
        return "%.5f, %.5f".format(Locale.US, latitude, longitude)
    }

    private companion object {
        const val LOCATION_REQUEST_INTERVAL_MILLIS = 10_000L
        const val LOCATION_REQUEST_MIN_INTERVAL_MILLIS = 5_000L
        const val LOCATION_TIMEOUT_MILLIS = 20_000L
    }
}
