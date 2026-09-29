/**
 * Job: Define where an unfinished planner form is kept so it survives the app process being killed.
 *
 */
package com.trailmapper.shared

interface PlannerDraftStore {
    suspend fun load(slot: String): String?

    suspend fun save(
        slot: String,
        serialized: String,
    )

    suspend fun clear(slot: String)
}

/** Platforms without a draft store simply lose the form when the process dies, as before. */
object NoPlannerDraftStore : PlannerDraftStore {
    override suspend fun load(slot: String): String? = null

    override suspend fun save(
        slot: String,
        serialized: String,
    ) = Unit

    override suspend fun clear(slot: String) = Unit
}
