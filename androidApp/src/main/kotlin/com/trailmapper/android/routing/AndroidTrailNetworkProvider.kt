/**
 * Job: Load county trail data and separately verified local additions from Android assets.
 *
 */
package com.trailmapper.android.routing

import android.content.Context
import com.trailmapper.shared.TrailNetworkLoadResult
import com.trailmapper.shared.TrailNetworkProvider
import com.trailmapper.shared.routing.NormalizedTrailNetworkJsonSijko
import com.trailmapper.shared.routing.TrailNetworkFeature
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AndroidTrailNetworkProvider(
    private val context: Context,
) : TrailNetworkProvider {
    private var cachedResult: TrailNetworkLoadResult? = null

    override suspend fun loadTrailNetwork(): TrailNetworkLoadResult {
        cachedResult?.let { return it }
        return withContext(Dispatchers.IO) {
            val result = try {
                TrailNetworkLoadResult.Success(loadFeaturesFromAssets())
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                TrailNetworkLoadResult.Error(
                    exception.message ?: "Unable to load trail-network data.",
                )
            }
            cachedResult = result
            result
        }
    }

    private fun loadFeaturesFromAssets(): List<TrailNetworkFeature> {
        val features = listOf(ASSET_NAME, ADDITIONS_ASSET_NAME).flatMap { assetName ->
            val json = context.assets.open(assetName).bufferedReader().use { it.readText() }
            NormalizedTrailNetworkJsonSijko.features(json)
        }
        require(features.map { it.id }.toSet().size == features.size) {
            "Trail assets contain duplicate source feature IDs."
        }
        return features
    }

    private companion object {
        const val ASSET_NAME = "mcgis-trails.normalized.json"
        const val ADDITIONS_ASSET_NAME = "verified-trail-additions.normalized.json"
    }
}
