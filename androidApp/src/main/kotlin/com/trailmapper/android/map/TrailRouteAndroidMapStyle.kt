/**
 * Job: Convert shared route segment metadata into the Android colors, widths, patterns, and layers used by every map renderer.
 *
 */
package com.trailmapper.android.map

import androidx.compose.ui.graphics.Color
import com.google.android.gms.maps.model.Dash
import com.google.android.gms.maps.model.Gap
import com.google.android.gms.maps.model.PatternItem
import com.trailmapper.shared.routing.TrailNetworkRole
import com.trailmapper.shared.routing.TrailRouteDisplayStyle
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.routing.TrailRouteSegmentType

internal fun TrailRouteSegment.polylineBaseColor(): Color {
    return when {
        type == TrailRouteSegmentType.Access && !isRouted -> ESTIMATED_ACCESS_COLOR
        type == TrailRouteSegmentType.Access -> ACCESS_COLOR
        else -> displayStyle.baseColor(routeRoles)
    }
}

internal fun TrailRouteSegment.polylineWidth(): Float {
    return when {
        type == TrailRouteSegmentType.Trail -> TRAIL_POLYLINE_WIDTH
        isRouted -> ACCESS_POLYLINE_WIDTH
        else -> ESTIMATED_ACCESS_POLYLINE_WIDTH
    }
}

internal fun TrailRouteSegment.polylineBasePattern(): List<PatternItem>? {
    return when {
        type == TrailRouteSegmentType.Access && !isRouted -> ESTIMATED_ACCESS_PATTERN
        type == TrailRouteSegmentType.Trail && displayStyle == TrailRouteDisplayStyle.Proposed -> {
            LEGEND_DASH_PATTERN
        }
        else -> null
    }
}

internal fun TrailRouteSegment.polylineOverlayColor(): Color? {
    if (type != TrailRouteSegmentType.Trail) {
        return null
    }
    return when (displayStyle) {
        TrailRouteDisplayStyle.Route66Advanced -> Color.White
        TrailRouteDisplayStyle.Route66IllinoisCentral -> ILLINOIS_CENTRAL_COLOR
        TrailRouteDisplayStyle.Route66Southtown -> SOUTHTOWN_COLOR
        else -> null
    }
}

internal fun TrailRouteSegment.polylineOverlayWidth(): Float = ROUTE_OVERLAY_POLYLINE_WIDTH

internal fun TrailRouteSegment.polylineOverlayPattern(): List<PatternItem> = LEGEND_DASH_PATTERN

internal fun TrailRouteSegment.polylineZIndex(): Float {
    return when {
        type == TrailRouteSegmentType.Trail -> TRAIL_POLYLINE_Z_INDEX
        isRouted -> ACCESS_POLYLINE_Z_INDEX
        else -> ESTIMATED_ACCESS_POLYLINE_Z_INDEX
    }
}

private fun TrailRouteDisplayStyle.baseColor(routeRoles: Set<TrailNetworkRole>): Color {
    return when (this) {
        TrailRouteDisplayStyle.BloomerLine -> BLOOMER_LINE_COLOR
        TrailRouteDisplayStyle.Collegiate -> COLLEGIATE_COLOR
        TrailRouteDisplayStyle.IllinoisCentral -> ILLINOIS_CENTRAL_COLOR
        TrailRouteDisplayStyle.Interurban -> INTERURBAN_COLOR
        TrailRouteDisplayStyle.Northtown -> NORTHTOWN_COLOR
        TrailRouteDisplayStyle.Route66,
        TrailRouteDisplayStyle.Route66IllinoisCentral,
        TrailRouteDisplayStyle.Route66Southtown,
        -> ROUTE_66_COLOR
        TrailRouteDisplayStyle.Route66Advanced -> ROUTE_66_ADVANCED_COLOR
        TrailRouteDisplayStyle.Route66Alternate,
        TrailRouteDisplayStyle.SuggestedSharedRoadways,
        -> SUGGESTED_SHARED_ROADWAY_COLOR
        TrailRouteDisplayStyle.Southtown,
        TrailRouteDisplayStyle.Proposed,
        -> SOUTHTOWN_COLOR
        TrailRouteDisplayStyle.ParkTrailConnectors -> PARK_CONNECTOR_COLOR
        TrailRouteDisplayStyle.Unknown -> fallbackColorFor(routeRoles)
    }
}

private fun fallbackColorFor(routeRoles: Set<TrailNetworkRole>): Color {
    return when {
        TrailNetworkRole.SharedRoadways in routeRoles -> SUGGESTED_SHARED_ROADWAY_COLOR
        TrailNetworkRole.ParkConnectors in routeRoles -> PARK_CONNECTOR_COLOR
        else -> ROUTE_66_COLOR
    }
}

internal val TRAIL_BRANCH_COLOR = Color(0xFF2BB673)
private val BLOOMER_LINE_COLOR = Color(0xFFDA2128)
private val COLLEGIATE_COLOR = Color(0xFFC2996D)
private val ILLINOIS_CENTRAL_COLOR = Color(0xFFFFDE17)
private val INTERURBAN_COLOR = Color(0xFF58B0E2)
private val NORTHTOWN_COLOR = Color(0xFFB6E61C)
private val ROUTE_66_COLOR = TRAIL_BRANCH_COLOR
private val ROUTE_66_ADVANCED_COLOR = Color(0xFF6272C5)
private val SOUTHTOWN_COLOR = Color(0xFFFBB040)
private val PARK_CONNECTOR_COLOR = Color(0xBF875944)
private val SUGGESTED_SHARED_ROADWAY_COLOR = Color(0x996273C4)
private val ACCESS_COLOR = Color(0xFF4D6888)
private val ESTIMATED_ACCESS_COLOR = Color(0xFF946200)
private val ESTIMATED_ACCESS_PATTERN = listOf(Dash(18f), Gap(12f))
private val LEGEND_DASH_PATTERN = listOf(Dash(18f), Gap(12f))
private const val TRAIL_POLYLINE_WIDTH = 16f
private const val ROUTE_OVERLAY_POLYLINE_WIDTH = 7f
private const val ACCESS_POLYLINE_WIDTH = 10f
private const val ESTIMATED_ACCESS_POLYLINE_WIDTH = 8f
private const val TRAIL_POLYLINE_Z_INDEX = 2f
private const val ACCESS_POLYLINE_Z_INDEX = 1f
private const val ESTIMATED_ACCESS_POLYLINE_Z_INDEX = 0.5f
