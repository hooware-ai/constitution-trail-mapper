/**
 * Job: Render and persist one high-resolution shareable route image with lifecycle-bound cancellation.
 *
 */
package com.trailmapper.android.routing

import android.content.Context
import android.graphics.Bitmap
import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.routing.TrailRouteShareViewportSijko
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.maplibre.android.MapLibre
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.Style
import org.maplibre.android.snapshotter.MapSnapshotter
import java.io.File
import java.io.FileOutputStream

class AndroidTrailRouteImageExporter(
    private val context: Context,
    private val coroutineScope: CoroutineScope,
) {
    private var snapshotter: MapSnapshotter? = null
    private var timeoutJob: Job? = null
    private var completed = false

    fun export(
        savedRoute: SavedTrailRoute,
        onSuccess: (File) -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        val routePoints = savedRoute.route.segments.flatMap(TrailRouteSegment::points)
        val viewport = TrailRouteShareViewportSijko.viewportFor(routePoints)
            ?: return onFailure(IllegalArgumentException("The trail route has no drawable points."))

        runCatching {
            MapLibre.getInstance(context)
            val region = LatLngBounds.Builder()
                .include(LatLng(viewport.southLatitude, viewport.westLongitude))
                .include(LatLng(viewport.northLatitude, viewport.eastLongitude))
                .build()
            val options = MapSnapshotter.Options(EXPORT_MAP_SIZE_PIXELS, EXPORT_MAP_SIZE_PIXELS)
                .withPixelRatio(1f)
                .withStyleBuilder(Style.Builder().fromUri(OPEN_FREE_MAP_STYLE_URI))
                .withRegion(region)
            snapshotter = MapSnapshotter(context, options).also { renderer ->
                renderer.start(
                    { snapshot ->
                        if (completed) {
                            return@start
                        }
                        completed = true
                        timeoutJob?.cancel()
                        coroutineScope.launch {
                            runCatching {
                                val image = withContext(Dispatchers.Default) {
                                    AndroidTrailRouteShareImageComposer.compose(
                                        context = context,
                                        snapshot = snapshot,
                                        savedRoute = savedRoute,
                                    )
                                }
                                try {
                                    withContext(Dispatchers.IO) {
                                        image.writeToShareCache(savedRoute.id)
                                    }
                                } finally {
                                    image.recycle()
                                }
                            }.onSuccess(onSuccess).onFailure(onFailure)
                        }
                    },
                    { message -> completeFailure(IllegalStateException(message), onFailure) },
                )
            }
            timeoutJob = coroutineScope.launch {
                delay(EXPORT_TIMEOUT_MILLIS)
                completeFailure(
                    IllegalStateException("The route basemap did not finish loading."),
                    onFailure,
                )
            }
        }.onFailure { throwable -> completeFailure(throwable, onFailure) }
    }

    fun cancel() {
        timeoutJob?.cancel()
        snapshotter?.cancel()
        snapshotter = null
    }

    private fun completeFailure(
        throwable: Throwable,
        onFailure: (Throwable) -> Unit,
    ) {
        if (completed) {
            return
        }
        completed = true
        timeoutJob?.cancel()
        snapshotter?.cancel()
        onFailure(throwable)
    }

    private fun Bitmap.writeToShareCache(routeId: String): File {
        val directory = File(context.cacheDir, SHARE_CACHE_DIRECTORY).apply { mkdirs() }
        directory.listFiles()
            ?.filter { file -> System.currentTimeMillis() - file.lastModified() > CACHE_MAX_AGE_MILLIS }
            ?.forEach(File::delete)
        val safeRouteId = routeId.replace(UNSAFE_FILE_NAME_CHARACTERS, "-").take(64)
        val file = File(directory, "trail-route-$safeRouteId-${System.currentTimeMillis()}.png")
        FileOutputStream(file).use { output ->
            check(compress(Bitmap.CompressFormat.PNG, 100, output)) {
                "The route image could not be encoded."
            }
        }
        return file
    }

    private companion object {
        const val OPEN_FREE_MAP_STYLE_URI = "https://tiles.openfreemap.org/styles/liberty"
        const val EXPORT_MAP_SIZE_PIXELS = 2048
        const val EXPORT_TIMEOUT_MILLIS = 25_000L
        const val SHARE_CACHE_DIRECTORY = "shared_trail_routes"
        const val CACHE_MAX_AGE_MILLIS = 24 * 60 * 60 * 1000L
        val UNSAFE_FILE_NAME_CHARACTERS = Regex("[^A-Za-z0-9._-]")
    }
}
