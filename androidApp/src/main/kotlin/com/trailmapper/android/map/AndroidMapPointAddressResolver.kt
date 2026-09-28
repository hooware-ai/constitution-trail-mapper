/**
 * Job: Reverse-geocode a selected Android map coordinate into a route-field address.
 *
 */
package com.trailmapper.android.map

import android.content.Context
import android.location.Address
import android.location.Geocoder
import android.os.Build
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.MapPointLabelSijko
import java.util.Locale
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

class AndroidMapPointAddressResolver(private val context: Context) {
    suspend fun addressFor(point: MapPoint): String {
        return resolvedAddressFor(point) ?: MapPointLabelSijko.coordinateTextFor(point)
    }

    suspend fun resolvedAddressFor(point: MapPoint): String? {
        return try {
            withTimeoutOrNull(ADDRESS_TIMEOUT_MILLIS) {
                reverseGeocode(point)
            }
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            null
        }
    }

    private suspend fun reverseGeocode(point: MapPoint): String? {
        if (!Geocoder.isPresent()) {
            return null
        }

        val addresses = withContext(Dispatchers.IO) {
            val geocoder = Geocoder(context, Locale.getDefault())
            geocoder.getFromLocationCompat(
                latitude = point.latitude,
                longitude = point.longitude,
                maxResults = 1,
            )
        }

        return addresses
            .firstOrNull()
            ?.getAddressLine(0)
            ?.takeIf { it.isNotBlank() }
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

    private companion object {
        const val ADDRESS_TIMEOUT_MILLIS = 10_000L
    }
}
