package com.trailmapper.shared

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Instant

class LocalTrailGuideReviewTest {
    private fun epoch(iso: String) = Instant.parse(iso).toEpochMilliseconds()

    @Test
    fun unresolvedOverdueReviewsStayVisibleAfterOctober9Review() {
        val entries = LocalTrailGuide.entries().associateBy { it.id }
        val now = epoch("2026-10-09T12:00:00Z")
        for (id in listOf("hershey-work", "collegiate-repaving", "camelback-trail-closure", "trail-paving-raab")) {
            assertEquals("Recheck needed", entries.getValue(id).statusAt(now), id)
            assertEquals("Recheck needed", entries.getValue(id).statusAt(epoch("2028-07-01T00:00:00Z")), id)
        }
        assertTrue(entries.getValue("hershey-work").details.contains("indexed September 28"))
        assertTrue(entries.getValue("trail-paving-raab").details.contains("road-lane"))
    }

    @Test
    fun scheduledWorkStatusesDoNotClaimProgressOrAnElapsedEstimateEarly() {
        val entries = LocalTrailGuide.entries().associateBy { it.id }
        val hershey = entries.getValue("hershey-work")
        val hersheyStart = epoch("2026-09-08T05:00:00Z")
        assertTrue(hershey.statusAt(hersheyStart - 1).startsWith("Scheduled ·"))
        assertEquals("Scheduled start reached · current completion unverified", hershey.statusAt(hersheyStart))
        val collegiate = entries.getValue("collegiate-repaving")
        val collegiateStart = epoch("2026-09-28T05:00:00Z")
        assertTrue(collegiate.statusAt(collegiateStart - 1).startsWith("Scheduled"))
        for (at in listOf(collegiateStart, epoch("2026-10-02T22:00:00Z"))) {
            assertEquals("Work expected · targeted closures through October 2 estimate", collegiate.statusAt(at))
        }
        val raab = entries.getValue("trail-paving-raab")
        val raabStart = epoch("2026-10-03T11:00:00Z")
        assertTrue(raab.statusAt(raabStart - 1).startsWith("Scheduled"))
        assertEquals("Paving scheduled from October 3 · current trail access unverified", raab.statusAt(raabStart))
    }

    @Test
    fun refreshedUnresolvedNoticesHaveExplicitNextReviewBoundary() {
        for (id in listOf("storm-cleanup", "uptown-detour")) {
            val entry = LocalTrailGuide.entries().single { it.id == id }
            val deadline = epoch("2026-10-16T05:00:00Z")
            assertEquals(deadline, entry.reviewAfterEpochMillis)
            assertEquals(entry.status, entry.statusAt(deadline - 1))
            assertEquals("Recheck needed", entry.statusAt(deadline))
        }
        val uptown = LocalTrailGuide.entries().single { it.id == "uptown-detour" }
        assertTrue(uptown.details.contains("current status, exact endpoints and reopening"))
        assertTrue(uptown.details.contains("That phase is not mapped"))
        assertTrue(uptown.details.contains("Per the notice, after that initial phase reopens, a signed construction detour"))
        assertTrue(uptown.details.contains("mapped Phoenix-to-Uptown section"))
    }
}
