/**
 * Job: Load base streets plus endpoint-local service roads from normalized Android routing assets.
 *
 */
package com.trailmapper.android.routing

import android.content.Context
import android.util.JsonReader
import com.trailmapper.shared.AccessNetworkLoadResult
import com.trailmapper.shared.AccessNetworkProvider
import com.trailmapper.shared.sijko.MapPoint
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class AndroidAccessNetworkProvider(
    private val context: Context,
) : AccessNetworkProvider {
    private val loadMutex = Mutex()
    private var cachedResult: AccessNetworkLoadResult? = null
    private var cachedEndpointPoints: List<MapPoint> = emptyList()

    override suspend fun loadAccessNetwork(
        relevantEndpointPoints: List<MapPoint>,
    ): AccessNetworkLoadResult = loadMutex.withLock {
        cachedResult?.takeIf { cachedEndpointPoints == relevantEndpointPoints }?.let { return@withLock it }
        val result = withContext(Dispatchers.IO) {
            try {
                val coroutineContext = currentCoroutineContext()
                AccessNetworkLoadResult.Success(
                    JsonReader(context.assets.open(ASSET_NAME).bufferedReader()).use { reader ->
                        AndroidAccessNetworkJsonReader.readFeatures(
                            reader = reader,
                            relevantEndpointPoints = relevantEndpointPoints,
                            cancellationCheckpoint = { coroutineContext.ensureActive() },
                        )
                    },
                )
            } catch (exception: CancellationException) {
                throw exception
            } catch (exception: Exception) {
                AccessNetworkLoadResult.Error(
                    exception.message ?: "Unable to load ordinary-road access data.",
                )
            }
        }
        currentCoroutineContext().ensureActive()
        cachedEndpointPoints = relevantEndpointPoints.toList()
        cachedResult = result
        result
    }

    private companion object {
        const val ASSET_NAME = "mclean-access-roads.normalized.json"
    }
}
