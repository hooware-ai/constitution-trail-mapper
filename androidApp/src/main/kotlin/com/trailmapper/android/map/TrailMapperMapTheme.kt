package com.trailmapper.android.map

import com.google.maps.android.compose.ComposeMapColorScheme

/** Select presentation only; leave overlays, providers and exported share-image rendering unchanged. */
internal fun trailMapperMapColorScheme(darkTheme: Boolean): ComposeMapColorScheme =
    if (darkTheme) ComposeMapColorScheme.DARK else ComposeMapColorScheme.LIGHT
