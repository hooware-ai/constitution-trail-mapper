/**
 * Job: Serialize and deserialize drawable trail routes for Android map Activity handoff.
 *
 */
package com.trailmapper.android.map

import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteDisplayStyle
import com.trailmapper.shared.routing.TrailRouteKind
import com.trailmapper.shared.routing.TrailRouteNameSijko
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.routing.TrailRouteSegmentType
import com.trailmapper.shared.routing.TrailRouteTraversalEdge
import com.trailmapper.shared.routing.TrailNetworkRole
import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerSelection
import org.json.JSONArray
import org.json.JSONObject

object TrailRouteMapJsonSijko {
    fun encode(route: TrailRoute): String {
        return JSONObject()
            .put("totalDistanceMeters", route.totalDistanceMeters)
            .put("ordinaryAccessDistanceMeters", route.ordinaryAccessDistanceMeters)
            .put("sharedRoadwayDistanceMeters", route.sharedRoadwayDistanceMeters)
            .put("totalCost", route.totalCost)
            .put("kind", route.kind.name)
            .apply {
                route.requestedDistanceMeters?.let { distanceMeters ->
                    put("requestedDistanceMeters", distanceMeters)
                }
                route.routeLayers?.let { layers -> put("routeLayers", layers.toJson()) }
            }
            .put(
                "traversalEdges",
                JSONArray().apply {
                    route.traversalEdges.forEach { traversalEdge ->
                        put(traversalEdge.toJson())
                    }
                },
            )
            .put(
                "segments",
                JSONArray().apply {
                    route.segments.forEach { segment ->
                        put(segment.toJson())
                    }
                },
            )
            .toString()
    }

    fun decode(routeJson: String?): TrailRoute? {
        return runCatching {
            val root = JSONObject(routeJson ?: return null)
            TrailRoute(
                edges = emptyList(),
                segments = root.getJSONArray("segments").toRouteSegments(),
                totalDistanceMeters = root.requiredFiniteDouble("totalDistanceMeters"),
                ordinaryAccessDistanceMeters = root.requiredFiniteDouble("ordinaryAccessDistanceMeters"),
                sharedRoadwayDistanceMeters = root.optionalFiniteDouble("sharedRoadwayDistanceMeters", 0.0),
                totalCost = root.optionalFiniteDouble("totalCost", 0.0),
                kind = root.optionalRouteKind(),
                requestedDistanceMeters = root.optionalFiniteDoubleOrNull("requestedDistanceMeters"),
                traversalEdges = root.optionalTraversalEdges(),
                routeLayers = root.optJSONObject("routeLayers")?.toRouteLayers(),
            )
        }.getOrNull()
    }

    private fun TrailRouteSegment.toJson(): JSONObject {
        return JSONObject()
            .put("type", type.name)
            .put("isRouted", isRouted)
            .put("displayStyle", displayStyle.name)
            .put(
                "routeRoles",
                JSONArray().apply {
                    routeRoles.sortedBy { role -> role.ordinal }.forEach { role ->
                        put(role.name)
                    }
                },
            )
            .put(
                "points",
                JSONArray().apply {
                    points.forEach { point ->
                        put(point.toJson())
                    }
                },
            )
            .apply {
                TrailRouteNameSijko.normalized(name)?.let { normalizedName ->
                    put("name", normalizedName)
                }
            }
    }

    private fun RouteLayerSelection.toJson(): JSONObject {
        return JSONObject()
            .put("trailBranches", trailBranches)
            .put("parkConnectors", parkConnectors)
            .put("sharedRoadways", sharedRoadways)
            .put("proposedTrails", proposedTrails)
    }

    private fun JSONObject.toRouteLayers(): RouteLayerSelection {
        return RouteLayerSelection(
            trailBranches = getBoolean("trailBranches"),
            parkConnectors = getBoolean("parkConnectors"),
            sharedRoadways = getBoolean("sharedRoadways"),
            proposedTrails = getBoolean("proposedTrails"),
        )
    }

    private fun MapPoint.toJson(): JSONObject {
        return JSONObject()
            .put("latitude", latitude)
            .put("longitude", longitude)
    }

    private fun TrailRouteTraversalEdge.toJson(): JSONObject {
        return JSONObject()
            .put("key", key)
            .put("distanceMeters", distanceMeters)
            .put("ordinaryAccessDistanceMeters", ordinaryAccessDistanceMeters)
            .apply {
                if (junctionCoordinates.isNotEmpty()) {
                    put("junctionCoordinates", JSONArray(junctionCoordinates))
                }
                geometryMeters?.let { meters -> put("geometryMeters", meters) }
            }
    }

    private fun JSONObject.optionalRouteKind(): TrailRouteKind {
        val kindName = optionalString("kind") ?: return TrailRouteKind.Navigation
        return TrailRouteKind.entries.firstOrNull { kind -> kind.name == kindName }
            ?: TrailRouteKind.Navigation
    }

    private fun JSONObject.optionalTraversalEdges(): List<TrailRouteTraversalEdge> {
        if (!has("traversalEdges")) {
            return emptyList()
        }
        val traversalEdges = getJSONArray("traversalEdges")
        return buildList {
            for (index in 0 until traversalEdges.length()) {
                val traversalEdge = traversalEdges.getJSONObject(index)
                add(
                    TrailRouteTraversalEdge(
                        key = traversalEdge.requiredString("key"),
                        distanceMeters = traversalEdge.requiredFiniteDouble("distanceMeters"),
                        ordinaryAccessDistanceMeters = traversalEdge.optionalFiniteDouble(
                            name = "ordinaryAccessDistanceMeters",
                            defaultValue = 0.0,
                        ),
                        junctionCoordinates = traversalEdge.optJSONArray("junctionCoordinates")?.let { coordinates ->
                            List(coordinates.length()) { coordinateIndex -> coordinates.getString(coordinateIndex) }
                        }.orEmpty(),
                        geometryMeters = traversalEdge.optionalFiniteDoubleOrNull("geometryMeters"),
                    ),
                )
            }
        }
    }

    private fun JSONArray.toRouteSegments(): List<TrailRouteSegment> {
        return buildList {
            for (index in 0 until length()) {
                add(getJSONObject(index).toRouteSegment())
            }
        }
    }

    private fun JSONObject.toRouteSegment(): TrailRouteSegment {
        val points = getJSONArray("points").toMapPoints()
        require(points.size >= MINIMUM_SEGMENT_POINT_COUNT) {
            "Route segments must contain at least $MINIMUM_SEGMENT_POINT_COUNT points."
        }
        return TrailRouteSegment(
            type = TrailRouteSegmentType.valueOf(requiredString("type")),
            points = points,
            isRouted = optionalBoolean("isRouted", true),
            routeRoles = toRouteRoles(),
            displayStyle = toDisplayStyle(),
            name = TrailRouteNameSijko.normalized(optionalString("name")),
        )
    }

    private fun JSONObject.toDisplayStyle(): TrailRouteDisplayStyle {
        if (!has("displayStyle")) {
            return TrailRouteDisplayStyle.Unknown
        }
        return TrailRouteDisplayStyle.valueOf(requiredString("displayStyle"))
    }

    private fun JSONObject.toRouteRoles(): Set<TrailNetworkRole> {
        if (!has("routeRoles")) {
            return emptySet()
        }
        val routeRolesJson = getJSONArray("routeRoles")
        return buildSet {
            for (index in 0 until routeRolesJson.length()) {
                val role = routeRolesJson.get(index) as? String
                    ?: throw IllegalArgumentException("routeRoles entries must be strings.")
                add(TrailNetworkRole.valueOf(role))
            }
        }
    }

    private fun JSONArray.toMapPoints(): List<MapPoint> {
        return buildList {
            for (index in 0 until length()) {
                val point = getJSONObject(index)
                add(
                    MapPoint(
                        latitude = point.requiredFiniteDouble("latitude"),
                        longitude = point.requiredFiniteDouble("longitude"),
                    ),
                )
            }
        }
    }

    private fun JSONObject.requiredString(name: String): String {
        return get(name) as? String
            ?: throw IllegalArgumentException("$name must be a string.")
    }

    private fun JSONObject.optionalBoolean(
        name: String,
        defaultValue: Boolean,
    ): Boolean {
        if (!has(name)) {
            return defaultValue
        }
        return get(name) as? Boolean
            ?: throw IllegalArgumentException("$name must be a boolean.")
    }

    private fun JSONObject.optionalString(name: String): String? {
        if (!has(name) || isNull(name)) {
            return null
        }
        return get(name) as? String
            ?: throw IllegalArgumentException("$name must be a string.")
    }

    private fun JSONObject.requiredFiniteDouble(name: String): Double {
        val value = (get(name) as? Number)?.toDouble()
            ?: throw IllegalArgumentException("$name must be numeric.")
        require(value.isFinite()) {
            "$name must be finite."
        }
        return value
    }

    private fun JSONObject.optionalFiniteDouble(
        name: String,
        defaultValue: Double,
    ): Double {
        return if (has(name)) requiredFiniteDouble(name) else defaultValue
    }

    private fun JSONObject.optionalFiniteDoubleOrNull(name: String): Double? {
        return if (has(name) && !isNull(name)) requiredFiniteDouble(name) else null
    }

    private const val MINIMUM_SEGMENT_POINT_COUNT = 2
}
