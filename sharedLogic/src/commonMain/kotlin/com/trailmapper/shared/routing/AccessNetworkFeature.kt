/**
 * Job: Carry one ordinary road or path feature used only for endpoint access routing.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class AccessNetworkFeature(
    val id: String,
    val name: String? = null,
    val roadClass: String? = null,
    val paths: List<List<MapPoint>>,
)
