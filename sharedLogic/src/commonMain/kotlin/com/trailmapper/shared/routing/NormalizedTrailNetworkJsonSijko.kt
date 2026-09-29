/**
 * Job: Decode normalized county data and separately reviewed local trail additions.
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

object NormalizedTrailNetworkJsonSijko {
    fun features(json: String): List<TrailNetworkFeature> {
        // Windows PowerShell's UTF8 output can contain a leading byte-order mark.
        val root = Json.parseToJsonElement(json.removePrefix("\uFEFF")).jsonObject
        return root.getValue("layers").jsonArray.flatMap { layer ->
            layer.jsonObject.getValue("features").jsonArray.map { element ->
                val feature = element.jsonObject
                val roles = when (val value = feature.getValue("routeRoles")) {
                    is JsonArray -> value.map { it.jsonPrimitive.content }
                    is JsonPrimitive -> listOf(value.content)
                    else -> emptyList()
                }
                TrailNetworkFeature(
                    id = feature.getValue("id").jsonPrimitive.content,
                    name = feature.optionalString("name"),
                    status = if (feature.optionalString("status") == "Proposed") {
                        TrailFeatureStatus.Proposed
                    } else {
                        TrailFeatureStatus.Existing
                    },
                    routeRoles = roles.mapNotNull { role ->
                        TrailNetworkRole.entries.firstOrNull { it.name == role }
                    }.toSet(),
                    facilityType = when (feature.optionalString("facilityType")) {
                        "Bike Lane" -> TrailFacilityType.BikeLane
                        "Off-Road Trail" -> TrailFacilityType.OffRoadTrail
                        "Separated Trail" -> TrailFacilityType.SeparatedTrail
                        "Shared Lane" -> TrailFacilityType.SharedLane
                        "Urban Trail" -> TrailFacilityType.UrbanTrail
                        "Other" -> TrailFacilityType.Other
                        else -> TrailFacilityType.Unknown
                    },
                    comfortLevel = when (feature.optionalString("comfort")) {
                        "All Ages and Abilities" -> TrailComfortLevel.AllAgesAndAbilities
                        "Most Adults" -> TrailComfortLevel.MostAdults
                        "Experienced Bicyclists" -> TrailComfortLevel.ExperiencedBicyclists
                        "Strong and Fearless" -> TrailComfortLevel.StrongAndFearless
                        else -> TrailComfortLevel.Unknown
                    },
                    paths = feature.getValue("paths").jsonArray.map { path ->
                        path.jsonArray.map { coordinate ->
                            val values = coordinate.jsonArray
                            MapPoint(latitude = values[1].jsonPrimitive.double, longitude = values[0].jsonPrimitive.double)
                        }
                    },
                )
            }
        }
    }

    private fun JsonObject.optionalString(name: String): String? =
        get(name)?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
}
