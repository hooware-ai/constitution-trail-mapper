/**
 * Job: Keep optional account features unavailable on platforms without a sign-in implementation.
 *
 */
package com.trailmapper.shared

object NoTrailAccountProvider : TrailAccountProvider {
    override suspend fun currentAccount(): TrailUserAccount? = null

    override suspend fun signIn(): TrailAccountResult = TrailAccountResult.Unavailable

    override suspend fun signOut() = Unit
}
