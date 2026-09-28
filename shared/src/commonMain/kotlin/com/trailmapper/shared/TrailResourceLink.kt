/**
 * Job: Carry one Constitution Trail resource link and the part of the app it belongs in.
 *
 */
package com.trailmapper.shared

data class TrailResourceLink(
    val title: String,
    val url: String,
    val description: String? = null,
    val group: TrailResourceGroup = TrailResourceGroup.Community,
)

/** Maps and community pages sit under Explore; closure notices and rules under Updates. */
enum class TrailResourceGroup(val heading: String) {
    Maps("Online maps"),
    Community("Trail organizations"),
    Notices("Official closure notices"),
    Rules("Trail rules"),
}
