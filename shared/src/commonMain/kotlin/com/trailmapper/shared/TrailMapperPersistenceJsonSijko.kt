/**
 * Job: Encode and decode durable saved destinations and routes without dropping route graph metadata.
 *
 */
package com.trailmapper.shared

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

object TrailMapperPersistenceJsonSijko {
    private val json = Json {
        encodeDefaults = true
        explicitNulls = true
        ignoreUnknownKeys = true
    }

    fun encodeDestinations(destinations: List<SavedDestination>): String {
        return json.encodeToString(destinations)
    }

    fun decodeDestinations(serializedDestinations: String): List<SavedDestination>? {
        return runCatching {
            json.decodeFromString<List<SavedDestination>>(serializedDestinations)
        }.getOrNull()
    }

    fun encodeRoutes(routes: List<SavedTrailRoute>): String {
        return json.encodeToString(routes)
    }

    fun decodeRoutes(serializedRoutes: String): List<SavedTrailRoute>? {
        return runCatching {
            json.decodeFromString<List<SavedTrailRoute>>(serializedRoutes)
        }.getOrNull()
    }

    fun encodeRecentRoutes(routes: List<RecentTrailRoute>): String {
        return json.encodeToString(routes)
    }

    fun decodeRecentRoutes(serializedRoutes: String): List<RecentTrailRoute>? {
        return runCatching {
            json.decodeFromString<List<RecentTrailRoute>>(serializedRoutes)
        }.getOrNull()
    }

    fun encodeCarriedExerciseRide(ride: CarriedExerciseRide): String = json.encodeToString(ride)

    fun decodeCarriedExerciseRide(serializedRide: String): CarriedExerciseRide? {
        return runCatching { json.decodeFromString<CarriedExerciseRide>(serializedRide) }.getOrNull()
    }

    fun encodeCompletedExerciseSessions(sessions: List<CompletedExerciseSession>): String {
        return json.encodeToString(sessions)
    }

    fun decodeCompletedExerciseSessions(serializedSessions: String): List<CompletedExerciseSession>? {
        return runCatching {
            json.decodeFromString<List<CompletedExerciseSession>>(serializedSessions)
        }.getOrNull()
    }
}
