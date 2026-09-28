/**
 * Job: Stream normalized access features without materializing the asset text or its full JSON tree.
 *
 */
package com.trailmapper.android.routing

import android.util.JsonReader
import android.util.JsonToken
import com.trailmapper.shared.routing.AccessNetworkFeature
import com.trailmapper.shared.routing.AccessNetworkFeatureProximitySijko
import com.trailmapper.shared.sijko.MapPoint

internal object AndroidAccessNetworkJsonReader {
    fun readFeatures(
        reader: JsonReader,
        relevantEndpointPoints: List<MapPoint>,
        cancellationCheckpoint: () -> Unit = {},
    ): List<AccessNetworkFeature> {
        val result = mutableListOf<AccessNetworkFeature>()
        var foundLayers = false
        reader.beginObject()
        while (reader.hasNext()) {
            cancellationCheckpoint()
            when (reader.nextName()) {
                "layers" -> {
                    foundLayers = true
                    reader.beginArray()
                    while (reader.hasNext()) {
                        reader.readLayer(result, relevantEndpointPoints, cancellationCheckpoint)
                    }
                    reader.endArray()
                }
                else -> reader.skipValue()
            }
        }
        reader.endObject()
        require(foundLayers) { "Access-network data is missing its layers." }
        return result
    }

    private fun JsonReader.readLayer(
        result: MutableList<AccessNetworkFeature>,
        endpointPoints: List<MapPoint>,
        cancellationCheckpoint: () -> Unit,
    ) {
        var isEndpointLocal: Boolean? = null
        var foundFeatures = false
        val pendingLayerId = mutableListOf<AccessNetworkFeature>()

        fun addIfIncluded(feature: AccessNetworkFeature) {
            if (isEndpointLocal != true || AccessNetworkFeatureProximitySijko.isNearAnyPoint(
                    feature = feature,
                    points = endpointPoints,
                    maxDistanceMeters = ENDPOINT_LOCAL_RADIUS_METERS,
                )
            ) {
                result += feature
            }
        }

        beginObject()
        while (hasNext()) {
            cancellationCheckpoint()
            when (nextName()) {
                "id" -> {
                    isEndpointLocal = nullableString() == ENDPOINT_LOCAL_LAYER_ID
                    pendingLayerId.forEach(::addIfIncluded)
                    pendingLayerId.clear()
                }
                "features" -> {
                    foundFeatures = true
                    beginArray()
                    while (hasNext()) {
                        cancellationCheckpoint()
                        val feature = readFeature(cancellationCheckpoint)
                        if (isEndpointLocal == null) {
                            pendingLayerId += feature
                        } else {
                            addIfIncluded(feature)
                        }
                    }
                    endArray()
                }
                else -> skipValue()
            }
        }
        endObject()
        require(foundFeatures) { "An access-network layer is missing its features." }
        pendingLayerId.forEach(::addIfIncluded)
    }

    private fun JsonReader.readFeature(cancellationCheckpoint: () -> Unit): AccessNetworkFeature {
        var id: String? = null
        var name: String? = null
        var roadClass: String? = null
        var paths: List<List<MapPoint>>? = null
        beginObject()
        while (hasNext()) {
            when (nextName()) {
                "id" -> id = nextString()
                "name" -> name = nullableString()
                "mtfcc" -> roadClass = nullableString()
                "paths" -> paths = readPaths(cancellationCheckpoint)
                else -> skipValue()
            }
        }
        endObject()
        return AccessNetworkFeature(
            id = requireNotNull(id) { "An access-network feature is missing its id." },
            name = name,
            roadClass = roadClass,
            paths = requireNotNull(paths) { "An access-network feature is missing its paths." },
        )
    }

    private fun JsonReader.readPaths(cancellationCheckpoint: () -> Unit): List<List<MapPoint>> {
        val paths = mutableListOf<List<MapPoint>>()
        beginArray()
        while (hasNext()) {
            val path = mutableListOf<MapPoint>()
            beginArray()
            while (hasNext()) {
                cancellationCheckpoint()
                beginArray()
                val longitude = nextDouble()
                val latitude = nextDouble()
                while (hasNext()) {
                    skipValue()
                }
                endArray()
                path += MapPoint(latitude = latitude, longitude = longitude)
            }
            endArray()
            paths += path
        }
        endArray()
        return paths
    }

    private fun JsonReader.nullableString(): String? {
        return if (peek() == JsonToken.NULL) {
            nextNull()
            null
        } else {
            nextString().takeIf { it.isNotBlank() }
        }
    }

    private const val ENDPOINT_LOCAL_LAYER_ID = "osm-service"
    private const val ENDPOINT_LOCAL_RADIUS_METERS = 600.0
}
