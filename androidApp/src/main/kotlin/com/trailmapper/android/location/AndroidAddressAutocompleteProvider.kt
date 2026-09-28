/**
 * Job: Use Google Places autocomplete to resolve typed route endpoints into addresses and coordinates.
 *
 */
package com.trailmapper.android.location

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.maps.model.LatLng
import com.google.android.libraries.places.api.Places
import com.google.android.libraries.places.api.model.AutocompletePrediction
import com.google.android.libraries.places.api.model.AutocompleteSessionToken
import com.google.android.libraries.places.api.model.Place
import com.google.android.libraries.places.api.model.RectangularBounds
import com.google.android.libraries.places.api.net.FetchPlaceRequest
import com.google.android.libraries.places.api.net.FindAutocompletePredictionsRequest
import com.google.android.libraries.places.api.net.PlacesClient
import com.trailmapper.shared.AddressAutocompletePrediction
import com.trailmapper.shared.AddressAutocompleteProvider
import com.trailmapper.shared.AddressAutocompleteSelectionResult
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteEndpointTarget
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.tasks.await

class AndroidAddressAutocompleteProvider(
    context: Context,
) : AddressAutocompleteProvider {
    private val appContext = context.applicationContext
    private val placesClient: PlacesClient? = createPlacesClient()
    private val sessionTokens = mutableMapOf<RouteEndpointTarget, AutocompleteSessionToken>()

    override val isAvailable: Boolean
        get() = placesClient != null

    override suspend fun predictions(
        query: String,
        target: RouteEndpointTarget,
    ): List<AddressAutocompletePrediction> {
        val client = placesClient ?: return emptyList()
        val request = FindAutocompletePredictionsRequest.builder()
            .setQuery(query.trim())
            .setCountries(UNITED_STATES_COUNTRY_CODE)
            .setLocationBias(BLOOMINGTON_NORMAL_BOUNDS)
            .setSessionToken(sessionTokenFor(target))
            .build()

        return client.findAutocompletePredictions(request)
            .await()
            .autocompletePredictions
            .map(AutocompletePrediction::toSharedPrediction)
    }

    override suspend fun resolvePrediction(
        prediction: AddressAutocompletePrediction,
        target: RouteEndpointTarget,
    ): AddressAutocompleteSelectionResult {
        val client = placesClient ?: return AddressAutocompleteSelectionResult.Unavailable
        val sessionToken = sessionTokenFor(target)
        val request = FetchPlaceRequest.builder(prediction.placeId, PLACE_FIELDS)
            .setSessionToken(sessionToken)
            .build()

        return try {
            val place = client.fetchPlace(request).await().place
            val location = place.location
                ?: return AddressAutocompleteSelectionResult.Error("The selected place did not include a location.")
            val address = place.formattedAddress
                ?: place.displayName
                ?: prediction.fullText
            AddressAutocompleteSelectionResult.Success(
                address = address,
                point = MapPoint(
                    latitude = location.latitude,
                    longitude = location.longitude,
                ),
            )
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: Exception) {
            AddressAutocompleteSelectionResult.Error(
                exception.message ?: "The selected place could not be resolved.",
            )
        } finally {
            resetSessionToken(target)
        }
    }

    private fun createPlacesClient(): PlacesClient? {
        val apiKey = appContext.mapsApiKey()
        if (apiKey.isBlank() || apiKey.startsWith("\${")) {
            return null
        }

        return runCatching {
            if (!Places.isInitialized()) {
                Places.initializeWithNewPlacesApiEnabled(appContext, apiKey)
            }
            Places.createClient(appContext)
        }.getOrNull()
    }

    private fun sessionTokenFor(target: RouteEndpointTarget): AutocompleteSessionToken {
        return synchronized(sessionTokens) {
            sessionTokens.getOrPut(target) { AutocompleteSessionToken.newInstance() }
        }
    }

    private fun resetSessionToken(target: RouteEndpointTarget) {
        synchronized(sessionTokens) {
            sessionTokens.remove(target)
        }
    }
}

private fun AutocompletePrediction.toSharedPrediction(): AddressAutocompletePrediction {
    return AddressAutocompletePrediction(
        placeId = placeId,
        primaryText = getPrimaryText(null).toString(),
        secondaryText = getSecondaryText(null).toString(),
        fullText = getFullText(null).toString(),
    )
}

private fun Context.mapsApiKey(): String {
    val appInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.getApplicationInfo(
            packageName,
            PackageManager.ApplicationInfoFlags.of(PackageManager.GET_META_DATA.toLong()),
        )
    } else {
        @Suppress("DEPRECATION")
        packageManager.getApplicationInfo(packageName, PackageManager.GET_META_DATA)
    }
    return appInfo.metaData?.getString(MAPS_API_KEY_METADATA_NAME).orEmpty()
}

private const val MAPS_API_KEY_METADATA_NAME = "com.google.android.geo.API_KEY"
private const val UNITED_STATES_COUNTRY_CODE = "US"

private val BLOOMINGTON_NORMAL_BOUNDS = RectangularBounds.newInstance(
    LatLng(40.35, -89.30),
    LatLng(40.67, -88.70),
)

private val PLACE_FIELDS = listOf(
    Place.Field.DISPLAY_NAME,
    Place.Field.FORMATTED_ADDRESS,
    Place.Field.LOCATION,
)
