/**
 * Job: Key nearby coordinates into spatial buckets while building a trail graph.
 *
 */
package com.trailmapper.shared.routing

internal data class TrailGraphGridKey(
    val latitudeBucket: Int,
    val longitudeBucket: Int,
)
