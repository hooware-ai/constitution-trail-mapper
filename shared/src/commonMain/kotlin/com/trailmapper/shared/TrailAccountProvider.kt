/**
 * Job: Define the shared platform boundary for optional Google account identity.
 *
 */
package com.trailmapper.shared

interface TrailAccountProvider {
    suspend fun currentAccount(): TrailUserAccount?

    suspend fun signIn(): TrailAccountResult

    suspend fun signOut()
}
