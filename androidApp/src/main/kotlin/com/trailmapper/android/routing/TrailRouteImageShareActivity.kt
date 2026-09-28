/**
 * Job: Own the Android route-image export lifecycle and hand the completed PNG to the system share sheet.
 *
 */
package com.trailmapper.android.routing

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.lifecycleScope
import com.trailmapper.android.map.TrailRouteMapJsonSijko
import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.sijko.SavedTrailRouteShareTextSijko
import java.io.File

class TrailRouteImageShareActivity : ComponentActivity() {
    private var imageExporter: AndroidTrailRouteImageExporter? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val savedRoute = intent.toSavedTrailRoute()
        if (savedRoute == null) {
            finish()
            return
        }

        setContent {
            MaterialTheme {
                TrailRouteShareProgressScreen()
            }
        }
        imageExporter = AndroidTrailRouteImageExporter(
            context = applicationContext,
            coroutineScope = lifecycleScope,
        ).also { exporter ->
            exporter.export(
                savedRoute = savedRoute,
                onSuccess = { file -> shareImage(savedRoute, file) },
                onFailure = {
                    Toast.makeText(
                        this,
                        "Map image unavailable. Sharing route details instead.",
                        Toast.LENGTH_SHORT,
                    ).show()
                    shareText(savedRoute)
                },
            )
        }
    }

    override fun onDestroy() {
        imageExporter?.cancel()
        super.onDestroy()
    }

    private fun shareImage(
        savedRoute: SavedTrailRoute,
        file: File,
    ) {
        val imageUri = FileProvider.getUriForFile(
            this,
            "$packageName.fileprovider",
            file,
        )
        val sendIntent = Intent(Intent.ACTION_SEND)
            .setType("image/png")
            .putExtra(Intent.EXTRA_SUBJECT, savedRoute.title)
            .putExtra(Intent.EXTRA_TEXT, SavedTrailRouteShareTextSijko.textFor(savedRoute))
            .putExtra(Intent.EXTRA_STREAM, imageUri)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            .apply {
                clipData = ClipData.newRawUri(savedRoute.title, imageUri)
            }
        openShareChooser(sendIntent)
    }

    private fun shareText(savedRoute: SavedTrailRoute) {
        val sendIntent = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, savedRoute.title)
            .putExtra(Intent.EXTRA_TEXT, SavedTrailRouteShareTextSijko.textFor(savedRoute))
        openShareChooser(sendIntent)
    }

    private fun openShareChooser(sendIntent: Intent) {
        startActivity(Intent.createChooser(sendIntent, "Share trail route"))
        finish()
    }

    private fun Intent.toSavedTrailRoute(): SavedTrailRoute? {
        val route = TrailRouteMapJsonSijko.decode(getStringExtra(EXTRA_ROUTE_JSON)) ?: return null
        return SavedTrailRoute(
            id = getStringExtra(EXTRA_ROUTE_ID).orEmpty(),
            title = getStringExtra(EXTRA_ROUTE_TITLE).orEmpty().ifBlank { "Trail route" },
            summary = getStringExtra(EXTRA_ROUTE_SUMMARY).orEmpty(),
            route = route,
        )
    }

    companion object {
        private const val EXTRA_ROUTE_ID = "com.trailmapper.android.routing.EXTRA_ROUTE_ID"
        private const val EXTRA_ROUTE_TITLE = "com.trailmapper.android.routing.EXTRA_ROUTE_TITLE"
        private const val EXTRA_ROUTE_SUMMARY = "com.trailmapper.android.routing.EXTRA_ROUTE_SUMMARY"
        private const val EXTRA_ROUTE_JSON = "com.trailmapper.android.routing.EXTRA_ROUTE_JSON"

        fun createIntent(
            context: Context,
            savedRoute: SavedTrailRoute,
        ): Intent {
            return Intent(context, TrailRouteImageShareActivity::class.java)
                .putExtra(EXTRA_ROUTE_ID, savedRoute.id)
                .putExtra(EXTRA_ROUTE_TITLE, savedRoute.title)
                .putExtra(EXTRA_ROUTE_SUMMARY, savedRoute.summary)
                .putExtra(EXTRA_ROUTE_JSON, TrailRouteMapJsonSijko.encode(savedRoute.route))
        }
    }
}

@Composable
private fun TrailRouteShareProgressScreen() {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(
                space = 16.dp,
                alignment = Alignment.CenterVertically,
            ),
        ) {
            CircularProgressIndicator()
            Text(
                text = "Preparing trail map",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
    }
}
