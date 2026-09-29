/**
 * Job: Verify same-named branches are listed nearest first, other results keep their place, and distances read well.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.AddressAutocompletePrediction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class AddressPredictionRankingSijkoTest {
    @Test
    fun theNearerBranchOfASameNamedPlaceComesFirst() {
        val farWestSide = prediction("far", "Culver's", "Rte 9, Bloomington", 14_000)
        val hersheyRoad = prediction("near", "Culver's", "Hershey Rd, Bloomington", 1_200)

        assertEquals(
            listOf(hersheyRoad, farWestSide),
            AddressPredictionRankingSijko.rankNearestFirst(listOf(farWestSide, hersheyRoad)),
        )
    }

    @Test
    fun differentPlacesKeepTheProvidersOrderAndEachGroupKeepsItsSlots() {
        val farCulvers = prediction("c-far", "Culver's", "West side", 14_000)
        val park = prediction("park", "Culver's Park", "Normal", 300)
        val nearCulvers = prediction("c-near", "Culver's", "Hershey Rd", 1_200)
        val other = prediction("other", "Kroger", "Main St", 100)

        assertEquals(
            listOf(nearCulvers, park, farCulvers, other),
            AddressPredictionRankingSijko.rankNearestFirst(listOf(farCulvers, park, nearCulvers, other)),
        )
    }

    @Test
    fun suggestionsWithoutADistanceGoLastWithinTheirGroupAndNamesMatchLoosely() {
        val unknown = prediction("unknown", "Culver's", "Somewhere", null)
        val known = prediction("known", " culver's ", "Hershey Rd", 900)

        assertEquals(
            listOf(known, unknown),
            AddressPredictionRankingSijko.rankNearestFirst(listOf(unknown, known)),
        )
    }

    @Test
    fun withoutAnyDistanceTheOrderIsUntouched() {
        val a = prediction("a", "Culver's", "One", null)
        val b = prediction("b", "Culver's", "Two", null)

        assertEquals(listOf(a, b), AddressPredictionRankingSijko.rankNearestFirst(listOf(a, b)))
        assertEquals(emptyList(), AddressPredictionRankingSijko.rankNearestFirst(emptyList()))
    }

    @Test
    fun equalDistancesKeepTheirProviderOrder() {
        val a = prediction("a", "Culver's", "One", 500)
        val b = prediction("b", "Culver's", "Two", 500)

        assertEquals(listOf(a, b), AddressPredictionRankingSijko.rankNearestFirst(listOf(a, b)))
    }

    @Test
    fun distancesReadInMiles() {
        assertEquals("0.7 mi away", AddressPredictionRankingSijko.distanceText(prediction("a", "A", "", 1_100)))
        assertEquals("8.7 mi away", AddressPredictionRankingSijko.distanceText(prediction("a", "A", "", 14_000)))
        assertEquals("Under 0.1 mi away", AddressPredictionRankingSijko.distanceText(prediction("a", "A", "", 40)))
        assertNull(AddressPredictionRankingSijko.distanceText(prediction("a", "A", "", null)))
    }

    private fun prediction(
        id: String,
        primary: String,
        secondary: String,
        distanceMeters: Int?,
    ) = AddressAutocompletePrediction(
        placeId = id,
        primaryText = primary,
        secondaryText = secondary,
        fullText = "$primary, $secondary",
        distanceMeters = distanceMeters,
    )
}
