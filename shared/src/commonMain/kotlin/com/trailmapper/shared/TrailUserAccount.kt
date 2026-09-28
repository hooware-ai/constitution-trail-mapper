/**
 * Job: Carry the signed-in Google account profile Trail Mapper can show in shared UI.
 *
 */
package com.trailmapper.shared

data class TrailUserAccount(
    val id: String,
    val displayName: String,
    val email: String,
    val profileImageUrl: String?,
)
