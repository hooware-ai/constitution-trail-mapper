/**
 * Job: Present Trail Mapper's disclosures and official map and routing sources.
 *
 */
package com.trailmapper.shared

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Link
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import com.trailmapper.shared.sijko.TrailMapperAboutSourceLinksSijko

object TrailMapperAbout {
    fun disclosureSections(): List<TrailMapperAboutDisclosureSection> {
        return listOf(
            TrailMapperAboutDisclosureSection(
                title = "Safety",
                body = "Route suggestions are informational. Check local conditions, closures, traffic, " +
                    "weather, and your own ability before traveling. Proposed trails are opt-in route " +
                    "data, not default usable infrastructure.",
            ),
            TrailMapperAboutDisclosureSection(
                title = "Data and privacy",
                body = "Routes and destinations are saved locally on this device. Google sign-in is optional " +
                    "and currently does not sync routes or destinations. Location is used only when you " +
                    "request it for routing or navigation.",
            ),
            TrailMapperAboutDisclosureSection(
                title = "Independent project",
                body = "Trail Mapper is an independent project and is not affiliated with or endorsed by the " +
                    "agencies, providers, or projects listed here.",
            ),
        )
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    fun Screen(
        externalLinkOpener: ExternalLinkOpener,
        onBack: () -> Unit,
    ) {
        val sourceLinks = remember { TrailMapperAboutSourceLinksSijko.links() }
        val disclosures = remember { disclosureSections() }

        Scaffold(
            modifier = Modifier.fillMaxSize(),
            topBar = {
                TopAppBar(
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Back to home",
                            )
                        }
                    },
                    title = {
                        Text(
                            text = "About Trail Mapper",
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = MaterialTheme.colorScheme.background,
                        titleContentColor = MaterialTheme.colorScheme.onBackground,
                        navigationIconContentColor = MaterialTheme.colorScheme.onBackground,
                    ),
                )
            },
            containerColor = MaterialTheme.colorScheme.background,
        ) { scaffoldPadding ->
            val layoutDirection = LocalLayoutDirection.current
            val startInset = if (layoutDirection == LayoutDirection.Ltr) {
                scaffoldPadding.calculateLeftPadding(layoutDirection)
            } else {
                scaffoldPadding.calculateRightPadding(layoutDirection)
            }
            val endInset = if (layoutDirection == LayoutDirection.Ltr) {
                scaffoldPadding.calculateRightPadding(layoutDirection)
            } else {
                scaffoldPadding.calculateLeftPadding(layoutDirection)
            }

            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .consumeWindowInsets(scaffoldPadding),
                contentPadding = PaddingValues(
                    start = startInset + 20.dp,
                    top = scaffoldPadding.calculateTopPadding() + 16.dp,
                    end = endInset + 20.dp,
                    bottom = scaffoldPadding.calculateBottomPadding() + 16.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(18.dp),
            ) {
                items(
                    items = disclosures.take(2),
                    key = TrailMapperAboutDisclosureSection::title,
                ) { section ->
                    AboutDisclosureSection(section)
                }

                item {
                    AboutSourcesHeader()
                }

                items(
                    items = sourceLinks,
                    key = TrailMapperAboutSourceLink::url,
                ) { link ->
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { externalLinkOpener.open(link.url) },
                        shape = RoundedCornerShape(8.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                    ) {
                        Row(
                            modifier = Modifier.padding(14.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                imageVector = Icons.Filled.Link,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Column(
                                modifier = Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(3.dp),
                            ) {
                                Text(
                                    text = link.title,
                                    style = MaterialTheme.typography.titleSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    text = link.role,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.OpenInNew,
                                contentDescription = "Open ${link.title}",
                                modifier = Modifier.size(20.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                items(
                    items = disclosures.drop(2),
                    key = TrailMapperAboutDisclosureSection::title,
                ) { section ->
                    AboutDisclosureSection(section)
                }
            }
        }
    }

    @Composable
    private fun AboutDisclosureSection(section: TrailMapperAboutDisclosureSection) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = section.title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text = section.body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }

    @Composable
    private fun AboutSourcesHeader() {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            HorizontalDivider()
            Text(
                text = "Map and routing sources",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Text(
                text = "Interactive map surfaces keep their provider attribution. This page supplements " +
                    "those attributions with the roles of the data, mapping, and rendering sources used here.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
