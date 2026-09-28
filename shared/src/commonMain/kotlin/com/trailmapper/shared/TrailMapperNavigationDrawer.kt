/**
 * Job: Present Trail Mapper's About destination and Constitution Trail resources in a Material 3 navigation drawer.
 *
 */
package com.trailmapper.shared

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Map
import androidx.compose.material3.DrawerState
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.NavigationDrawerItem
import androidx.compose.material3.Text
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@Composable
internal fun TrailMapperNavigationDrawer(
    resourceLinks: List<TrailResourceLink>,
    onOpenAbout: () -> Unit,
    onOpenLocalGuide: () -> Unit,
    onOpenResource: (TrailResourceLink) -> Unit,
    content: @Composable (openDrawer: () -> Unit) -> Unit,
) {
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val coroutineScope = rememberCoroutineScope()

    fun closeDrawerThen(action: () -> Unit) {
        coroutineScope.launch {
            drawerState.close()
            action()
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            TrailMapperDrawerSheet(
                drawerState = drawerState,
                resourceLinks = resourceLinks,
                onClose = { coroutineScope.launch { drawerState.close() } },
                onOpenAbout = { closeDrawerThen(onOpenAbout) },
                onOpenLocalGuide = { closeDrawerThen(onOpenLocalGuide) },
                onOpenResource = { link -> closeDrawerThen { onOpenResource(link) } },
            )
        },
    ) {
        content {
            coroutineScope.launch {
                drawerState.open()
            }
        }
    }
}

@Composable
private fun TrailMapperDrawerSheet(
    drawerState: DrawerState,
    resourceLinks: List<TrailResourceLink>,
    onClose: () -> Unit,
    onOpenAbout: () -> Unit,
    onOpenLocalGuide: () -> Unit,
    onOpenResource: (TrailResourceLink) -> Unit,
) {
    ModalDrawerSheet(drawerState = drawerState) {
        LazyColumn(
            modifier = Modifier
                .fillMaxHeight()
                .widthIn(max = 360.dp),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            item {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(start = 8.dp, bottom = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    TrailMapperMark(modifier = Modifier.size(48.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Trail Mapper",
                            style = MaterialTheme.typography.titleLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = "Bloomington-Normal",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    IconButton(onClick = onClose) {
                        Icon(
                            imageVector = Icons.Filled.Close,
                            contentDescription = "Close menu",
                        )
                    }
                }
            }

            item {
                HorizontalDivider(modifier = Modifier.padding(bottom = 8.dp))
            }

            item {
                NavigationDrawerItem(
                    label = { Text("Local updates & rules") },
                    selected = false,
                    onClick = onOpenLocalGuide,
                    modifier = Modifier.fillMaxWidth(),
                    icon = { Icon(Icons.Filled.Info, contentDescription = null) },
                )
            }

            item {
                NavigationDrawerItem(
                    label = { Text("About") },
                    selected = false,
                    onClick = onOpenAbout,
                    modifier = Modifier.fillMaxWidth(),
                    icon = {
                        Icon(
                            imageVector = Icons.Filled.Info,
                            contentDescription = null,
                        )
                    },
                )
            }

            item {
                HorizontalDivider(modifier = Modifier.padding(vertical = 8.dp))
            }

            item {
                Text(
                    text = "Constitution Trail resources",
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            items(
                items = resourceLinks,
                key = TrailResourceLink::url,
            ) { link ->
                NavigationDrawerItem(
                    label = {
                        Text(
                            text = link.title,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    selected = false,
                    onClick = { onOpenResource(link) },
                    modifier = Modifier.fillMaxWidth(),
                    icon = {
                        Icon(
                            imageVector = if (link.title.contains("rules", ignoreCase = true)) {
                                Icons.Filled.Bookmark
                            } else {
                                Icons.Filled.Map
                            },
                            contentDescription = null,
                        )
                    },
                    badge = {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                    },
                )
            }
        }
    }
}
