/**
 * Job: Prevent date estimates from silently turning closures or proposals into open infrastructure.
 */
package com.trailmapper.shared

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.time.Instant

class LocalTrailGuideTest {
    private val entries = LocalTrailGuide.entries()
    private fun at(iso: String) = Instant.parse(iso).toEpochMilliseconds()

    @Test
    fun estimatedClosureEndRequiresRecheckRatherThanClaimingReopening() {
        val closure = entries.single { it.id == "hamilton-rhodes" }
        // The official city map now estimates 6 p.m. CDT on October 31, 2026 (23:00Z); the older notice said September 30.
        assertTrue(closure.statusAt(at("2026-09-30T20:00:00Z")).contains("Closure reported"))
        assertTrue(closure.statusAt(at("2026-10-31T22:59:59Z")).contains("Closure reported"))
        assertEquals("Recheck needed", closure.statusAt(at("2026-10-31T23:00:00Z")))
        assertEquals("Recheck needed", closure.statusAt(at("2028-10-01T05:00:00Z")))
    }

    @Test
    fun dated2026OctoberNoticesAreScheduledThenEstimatedAndNeverBecomeAReopening() {
        fun status(id: String, iso: String) = entries.single { it.id == id }.statusAt(at(iso))
        // Willow Street trail crossing (Normal 3356): 6 a.m. CDT October 5 = 11:00Z, estimate 5 p.m. CDT October 19 = 22:00Z.
        assertTrue(status("willow-trail-closure", "2026-10-05T10:59:59Z").startsWith("Scheduled"))
        assertTrue(status("willow-trail-closure", "2026-10-05T11:00:00Z").startsWith("Closed since October 5"))
        assertEquals("Recheck needed", status("willow-trail-closure", "2026-10-19T22:00:00Z"))
        // Virginia Avenue / Camelback Bridge (Normal 3353): 8 a.m. CDT October 5 = 13:00Z, estimate 5 p.m. CDT October 6.
        assertTrue(status("camelback-trail-closure", "2026-10-05T12:59:59Z").startsWith("Scheduled"))
        assertTrue(status("camelback-trail-closure", "2026-10-05T13:00:00Z").startsWith("Closed at Virginia Avenue"))
        assertEquals("Recheck needed", status("camelback-trail-closure", "2026-10-06T22:00:00Z"))
        // Raab Road trail paving (Normal 3357): begins October 3; no end or trail sections are given.
        assertTrue(status("trail-paving-raab", "2026-10-03T10:59:59Z").startsWith("Scheduled"))
        assertTrue(status("trail-paving-raab", "2026-10-03T11:00:00Z").startsWith("Paving under way"))
        assertEquals("Recheck needed", status("collegiate-repaving", "2026-10-03T05:00:00Z"))
        assertTrue(entries.single { it.id == "trail-paving-raab" }.details.contains("does not say which trail sections close"))
    }

    @Test
    fun illinoisLawDoesNotBecomeCurrentBeforeJanuaryFirstInIllinois() {
        val law = entries.single { it.id == "illinois-2027" }
        assertTrue(law.statusAt(at("2027-01-01T05:59:59Z")).startsWith("Upcoming"))
        assertTrue(law.statusAt(at("2027-01-01T06:00:00Z")).startsWith("Effective"))
    }

    @Test
    fun passingAProjectTargetDoesNotMarkItOpen() {
        val future = at("2030-01-01T00:00:00Z")
        assertTrue(entries.single { it.id == "uptown" }.statusAt(future).contains("not open"))
        assertEquals("Recheck needed", entries.single { it.id == "veterans" }.statusAt(future))
        assertFalse(entries.single { it.id == "maxwell" }.statusAt(future).contains("complete", ignoreCase = true))
    }

    @Test
    fun partialRoadworkIsNotReportedAsAnAllTrafficClosure() {
        val works = entries.single { it.id == "hershey-work" }
        assertTrue(works.statusAt(at("2026-09-07T22:00:00Z")).startsWith("Scheduled"))
        assertTrue(works.statusAt(at("2026-09-08T05:00:00Z")).contains("check current notice"))
        assertTrue(works.details.contains("street stays open"))
    }

    @Test
    fun entriesRecheckedSeptember27AreCurrentUntilTheirNextReview() {
        listOf("storm-cleanup", "veterans", "uptown-detour").forEach { id ->
            val entry = entries.single { it.id == id }
            assertFalse(entry.statusAt(at("2026-09-27T17:00:00Z")) == "Recheck needed", id)
            assertEquals("Recheck needed", entry.statusAt(at("2026-10-27T05:00:00Z")), id)
        }
        assertTrue(LocalTrailGuide.freshnessMessage.contains(LocalTrailGuide.updatedOn))
    }

    @Test
    fun scheduledRepavingNeverReportsTheTrailReopened() {
        val repaving = entries.single { it.id == "collegiate-repaving" }
        assertTrue(repaving.statusAt(at("2026-09-27T17:00:00Z")).startsWith("Scheduled"))
        assertTrue(repaving.statusAt(at("2026-09-29T17:00:00Z")).contains("estimate"))
        assertEquals("Recheck needed", repaving.statusAt(at("2026-10-03T05:00:00Z")))
    }

    @Test
    fun uptownDetourKeepsTheDismountRuleAndTheUnderpassStaysUnopened() {
        val detour = entries.single { it.id == "uptown-detour" }
        assertTrue(detour.details.contains("dismount and walk your bike"))
        assertTrue(detour.details.contains("routes do not yet follow this detour"))
        assertTrue(entries.single { it.id == "uptown" }.statusAt(at("2026-09-27T17:00:00Z")).contains("not open"))
    }
}
