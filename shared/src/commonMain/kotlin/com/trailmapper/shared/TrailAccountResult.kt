/**
 * Job: Model the outcome of an optional Google account sign-in or sign-out request.
 *
 */
package com.trailmapper.shared

sealed class TrailAccountResult {
    data class Success(val account: TrailUserAccount) : TrailAccountResult()

    data class Error(val message: String) : TrailAccountResult()

    object Cancelled : TrailAccountResult()

    object Unavailable : TrailAccountResult()
}
