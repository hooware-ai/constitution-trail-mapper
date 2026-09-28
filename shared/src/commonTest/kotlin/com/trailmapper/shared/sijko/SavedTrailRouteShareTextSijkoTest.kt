/**
 * Job: Verify route shares retain their title, route summary, and Trail Mapper attribution.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.routing.TrailRoute
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.routing.TrailRouteSegmentType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SavedTrailRouteShareTextSijkoTest {
    @Test
    fun buildsCompleteShareText() {
        val savedRoute = SavedTrailRoute(
            id = "route-1",
            title = "Ride to Rivian",
            summary = "5.2 total miles.",
            route = TrailRoute(
                edges = emptyList(),
                totalDistanceMeters = 8_368.6,
                ordinaryAccessDistanceMeters = 0.0,
                totalCost = 8_368.6,
            ),
        )

        assertEquals(
            expected = "Ride to Rivian\n5.2 total miles.\n\nShared from Trail Mapper.",
            actual = SavedTrailRouteShareTextSijko.textFor(savedRoute),
        )
    }

    @Test
    fun includesTheClosureNoticeAndSourceWhenSharingAnAffectedSavedRoute() {
        val text = SavedTrailRouteShareTextSijko.textFor(hamiltonRoute(), September7)

        assertTrue(text.startsWith("Hamilton ride\n2.0 total miles.\n"))
        assertTrue(text.contains("Hamilton/Rhodes closure advisory"))
        assertTrue(text.contains("512 and 519 E. Hamilton Road"))
        assertTrue(text.contains("this route has not been detoured"))
        assertTrue(text.contains("https://www.bloomingtonil.gov/Home/Components/News/News/10909/1394"))
        assertTrue(text.endsWith("Shared from Trail Mapper."))
    }

    @Test
    fun retainsReopeningUncertaintyInSharesAfterTheEstimatedEnd() {
        val text = SavedTrailRouteShareTextSijko.textFor(hamiltonRoute(), October1)

        assertTrue(text.contains("reopening has not been confirmed"))
        assertTrue(text.contains("last checked September 7, 2026"))
    }

    @Test
    fun doesNotAddAClosureToParallelTrailShares() {
        val saved = hamiltonRoute()
        val trail = saved.copy(
            route = saved.route.copy(
                segments = saved.route.segments.map { it.copy(type = TrailRouteSegmentType.Trail) },
            ),
        )

        val text = SavedTrailRouteShareTextSijko.textFor(trail, September7)

        assertFalse(text.contains("closure", ignoreCase = true))
        assertEquals("Hamilton ride\n2.0 total miles.\n\nShared from Trail Mapper.", text)
    }

    @Test
    fun namesWhereAnOutAndBackTurnsAround() {
        val text = SavedTrailRouteShareTextSijko.textFor(trailShare(a, b, a), September7)

        assertEquals(
            "Spur ride\n1.0 total miles.\n1 turnaround: turn back at 0.3 mi.\n\nShared from Trail Mapper.",
            text,
        )
    }

    @Test
    fun listsEveryTurnaroundInRouteOrder() {
        val text = SavedTrailRouteShareTextSijko.textFor(trailShare(a, b, a, c, a), September7)

        assertTrue(text.contains("\n2 turnarounds: turn back at 0.3 mi and 0.9 mi.\n"), text)
    }

    @Test
    fun aLoopThatOnlyCrossesItselfKeepsTheOriginalText() {
        val loop = trailShare(a, b, MapPoint(40.0045, -88.994), MapPoint(40.0, -88.994), a)

        assertEquals(
            "Spur ride\n1.0 total miles.\n\nShared from Trail Mapper.",
            SavedTrailRouteShareTextSijko.textFor(loop, September7),
        )
    }

    private fun trailShare(vararg points: MapPoint) = SavedTrailRoute(
        id = "spur-route",
        title = "Spur ride",
        summary = "1.0 total miles.",
        route = TrailRoute(
            totalDistanceMeters = 1_609.344,
            ordinaryAccessDistanceMeters = 0.0,
            totalCost = 1_609.344,
            segments = listOf(TrailRouteSegment(TrailRouteSegmentType.Trail, points.toList(), name = "Main trail")),
        ),
    )

    // b is 500 m north of a; c is 500 m south.
    private val a = MapPoint(40.0, -89.0)
    private val b = MapPoint(40.0045, -89.0)
    private val c = MapPoint(39.9955, -89.0)

    private fun hamiltonRoute() = SavedTrailRoute(
        id = "hamilton-route",
        title = "Hamilton ride",
        summary = "2.0 total miles.",
        route = TrailRoute(
            totalDistanceMeters = 3_218.688,
            ordinaryAccessDistanceMeters = 200.0,
            totalCost = 3_218.688,
            segments = listOf(
                TrailRouteSegment(
                    type = TrailRouteSegmentType.Access,
                    name = "W Hamilton Rd",
                    points = listOf(
                        MapPoint(latitude = 40.45132199983461, longitude = -88.97905500029931),
                        MapPoint(latitude = 40.45133099984453, longitude = -88.9771480000203),
                    ),
                ),
            ),
        ),
    )

    private companion object {
        const val September7 = 1_788_782_400_000L
        const val October1 = 1_790_856_000_000L
    }
}
