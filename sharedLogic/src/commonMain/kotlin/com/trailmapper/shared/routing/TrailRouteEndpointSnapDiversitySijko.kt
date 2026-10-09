/**
 * Job: Keep endpoint snap searches from being crowded by many nearby segments of one feature.
 *
 */
package com.trailmapper.shared.routing

object TrailRouteEndpointSnapDiversitySijko {
    fun select(
        snaps: List<TrailNetworkSnap>,
        limit: Int,
        maxSnapsPerSourceFeature: Int = 4,
    ): List<TrailNetworkSnap> {
        if (limit <= 0 || maxSnapsPerSourceFeature <= 0) {
            return emptyList()
        }

        val selected = mutableListOf<TrailNetworkSnap>()
        val selectedKeys = mutableSetOf<SnapIdentity>()
        val countsByFeature = mutableMapOf<String, Int>()
        snaps.forEach { snap ->
            val featureKey = snap.featureKey()
            val identity = snap.identity()
            val count = countsByFeature.getOrElse(featureKey) { 0 }
            if (count < maxSnapsPerSourceFeature && identity !in selectedKeys) {
                selected += snap
                selectedKeys += identity
                countsByFeature[featureKey] = count + 1
                if (selected.size == limit) {
                    return selected
                }
            }
        }

        snaps.forEach { snap ->
            if (selected.size == limit) {
                return selected
            }
            val identity = snap.identity()
            if (identity !in selectedKeys) {
                selected += snap
                selectedKeys += identity
            }
        }

        return selected
    }

    private fun TrailNetworkSnap.featureKey(): String {
        return edge.sourceFeatureId ?: "edge:${edge.id}"
    }

    private fun TrailNetworkSnap.identity(): SnapIdentity {
        return SnapIdentity(
            sourceFeatureKey = featureKey(),
            latitude = projectedPoint.latitude,
            longitude = projectedPoint.longitude,
        )
    }
}
