/**
 * Job: Keep unfinished planner forms in their own SharedPreferences file, which backup rules leave on the device.
 *
 */
package com.trailmapper.android.routing

import android.content.Context
import com.trailmapper.shared.PlannerDraftStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AndroidPlannerDraftStore(
    context: Context,
) : PlannerDraftStore {
    private val preferences by lazy {
        context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    }

    override suspend fun load(slot: String): String? = withContext(Dispatchers.IO) {
        preferences.getString(slot, null)
    }

    override suspend fun save(
        slot: String,
        serialized: String,
    ) {
        // A draft is a convenience: a failed write must never disturb the form, so it is not checked.
        withContext(Dispatchers.IO) {
            preferences.edit().putString(slot, serialized).commit()
        }
    }

    override suspend fun clear(slot: String) {
        withContext(Dispatchers.IO) {
            preferences.edit().remove(slot).commit()
        }
    }

    companion object {
        /** Excluded by name in res/xml/data_extraction_rules.xml and res/xml/backup_rules.xml. */
        const val PREFERENCES_NAME = "trail_mapper_planner_drafts"
    }
}
