/**
 * Job: Pick which list item to bring into view when a search result or error arrives in a planner.
 *
 */
package com.trailmapper.shared.sijko

object PlannerScrollTargetSijko {
    /**
     * The item to reveal counted from the end of the list. The button item, which holds a failed search's
     * reason and its Try again action, is followed only by a result card when one is kept (a repeat failure
     * keeps the earlier result), so an error must skip past that card rather than land on it.
     */
    fun itemsAfterTarget(
        revealingButtonItem: Boolean,
        resultCardShown: Boolean,
    ): Int = if (revealingButtonItem && resultCardShown) 1 else 0

    fun targetIndex(
        totalItems: Int,
        itemsAfterTarget: Int,
    ): Int = (totalItems - 1 - itemsAfterTarget).coerceAtLeast(0)
}
