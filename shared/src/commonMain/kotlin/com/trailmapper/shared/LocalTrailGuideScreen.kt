/**
 * Job: Show dated local conditions, completed and planned routes, rules, and authoritative maps.
 */
package com.trailmapper.shared

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Info
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import kotlin.time.Clock

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LocalTrailGuideScreen(
    externalLinkOpener: ExternalLinkOpener,
    onBack: () -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Local updates & rules") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        LocalTrailGuideContent(
            externalLinkOpener = externalLinkOpener,
            modifier = Modifier.fillMaxSize().padding(padding),
        )
    }
}

/**
 * The guide's freshness note, category chips and entries. The Updates tab embeds it under the app's own
 * bars, adding its official links after the entries through [footer].
 */
@Composable
internal fun LocalTrailGuideContent(
    externalLinkOpener: ExternalLinkOpener,
    modifier: Modifier = Modifier,
    /** A heading above the guide, for when no top bar names it. */
    title: String? = null,
    horizontalPadding: PaddingValues = PaddingValues(horizontal = 20.dp),
    listBottomPadding: Dp = 20.dp,
    footer: LazyListScope.() -> Unit = {},
) {
    var categoryName by rememberSaveable { mutableStateOf(LocalTrailGuideCategory.Conditions.name) }
    var now by remember { mutableStateOf(Clock.System.now().toEpochMilliseconds()) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { now = Clock.System.now().toEpochMilliseconds() }
    val entries = remember { LocalTrailGuide.entries() }
    val category = LocalTrailGuideCategory.valueOf(categoryName)

    Column(modifier = modifier) {
        title?.let { titleText ->
            Text(
                text = titleText,
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.padding(horizontalPadding).padding(top = 16.dp).semantics { heading() },
            )
        }
        Text(
            LocalTrailGuide.freshnessMessage,
            modifier = Modifier.padding(horizontalPadding).padding(vertical = 12.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontalPadding),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            LocalTrailGuideCategory.entries.forEach { item ->
                FilterChip(
                    selected = category == item,
                    onClick = { categoryName = item.name },
                    label = { Text(item.label) },
                )
            }
        }
        val layoutDirection = LocalLayoutDirection.current
        LazyColumn(
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(
                start = horizontalPadding.calculateStartPadding(layoutDirection),
                top = 20.dp,
                end = horizontalPadding.calculateEndPadding(layoutDirection),
                bottom = listBottomPadding,
            ),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            items(entries.filter { it.category == category }, key = LocalTrailGuideEntry::id) { entry ->
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(entry.statusAt(now), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                        Text(entry.title, style = MaterialTheme.typography.titleMedium)
                        Text(entry.details, style = MaterialTheme.typography.bodyMedium)
                        TextButton(onClick = { externalLinkOpener.open(entry.source.url) }) {
                            Text(entry.source.title, modifier = Modifier.weight(1f))
                            Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null)
                        }
                    }
                }
            }
            footer()
        }
    }
}

@Composable
internal fun LocalTrailGuideShortcut(onOpen: () -> Unit, compact: Boolean = false) {
    if (compact) {
        TextButton(onClick = onOpen) { Text("Check local conditions & rules") }
    } else {
        Surface(
            modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.surfaceVariant,
        ) {
            Row(
                modifier = Modifier.padding(14.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Info, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(modifier = Modifier.weight(1f)) {
                    Text("Local updates & rules", style = MaterialTheme.typography.bodyMedium)
                    Text("Closures, route projects and e-bike guidance · reviewed September 7, 2026", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
