/**
 * Job: Carry one Constitution Trail resource link shown in the app menu.
 *
 */
package com.trailmapper.shared

data class TrailResourceLink(
    val title: String,
    val url: String,
    val description: String? = null,
    val showOnHome: Boolean = false,
)
