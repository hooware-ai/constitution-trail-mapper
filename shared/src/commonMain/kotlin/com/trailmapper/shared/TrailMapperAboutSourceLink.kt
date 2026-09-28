/**
 * Job: Carry one official source link and its role shown on Trail Mapper's About screen.
 *
 */
package com.trailmapper.shared

data class TrailMapperAboutSourceLink(
    val title: String,
    val role: String,
    val url: String,
)
