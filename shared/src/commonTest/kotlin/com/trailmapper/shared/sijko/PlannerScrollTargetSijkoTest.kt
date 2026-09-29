/**
 * Job: Verify an arriving error targets the button item even when an earlier result card follows it.
 *
 */
package com.trailmapper.shared.sijko

import kotlin.test.Test
import kotlin.test.assertEquals

class PlannerScrollTargetSijkoTest {
    @Test
    fun anErrorTargetsTheButtonItemAndSkipsAKeptResultCard() {
        // Items: ..., button (index 7), old result card (index 8).
        val skip = PlannerScrollTargetSijko.itemsAfterTarget(revealingButtonItem = true, resultCardShown = true)
        assertEquals(1, skip)
        assertEquals(7, PlannerScrollTargetSijko.targetIndex(totalItems = 9, itemsAfterTarget = skip))
    }

    @Test
    fun anErrorWithNoResultCardTargetsTheLastItem() {
        val skip = PlannerScrollTargetSijko.itemsAfterTarget(revealingButtonItem = true, resultCardShown = false)
        assertEquals(0, skip)
        assertEquals(7, PlannerScrollTargetSijko.targetIndex(totalItems = 8, itemsAfterTarget = skip))
    }

    @Test
    fun aRouteWithoutAMapTargetsItsOwnCardAtTheEnd() {
        val skip = PlannerScrollTargetSijko.itemsAfterTarget(revealingButtonItem = false, resultCardShown = true)
        assertEquals(0, skip)
        assertEquals(8, PlannerScrollTargetSijko.targetIndex(totalItems = 9, itemsAfterTarget = skip))
    }

    @Test
    fun theIndexNeverGoesNegative() {
        assertEquals(0, PlannerScrollTargetSijko.targetIndex(totalItems = 0, itemsAfterTarget = 1))
    }
}
