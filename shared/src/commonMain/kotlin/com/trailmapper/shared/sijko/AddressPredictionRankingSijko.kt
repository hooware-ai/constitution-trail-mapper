/**
 * Job: Put the nearest branch of a same-named place first and describe how far each suggestion is.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.AddressAutocompletePrediction

object AddressPredictionRankingSijko {
    /**
     * Keeps the provider's order between different places, but within each group of suggestions that share
     * a name (the branches of one business) lists the nearest first. Each group keeps the slots its members
     * held, so a relevant match is not pushed below unrelated results. Suggestions without a distance go
     * last within their group.
     */
    fun rankNearestFirst(predictions: List<AddressAutocompletePrediction>): List<AddressAutocompletePrediction> {
        if (predictions.none { prediction -> prediction.distanceMeters != null }) return predictions

        val slotsByName = predictions.indices.groupBy { index -> nameKey(predictions[index]) }
        val ranked = predictions.toMutableList()
        for (slots in slotsByName.values) {
            if (slots.size < 2) continue
            val nearestFirst = slots
                .map { index -> predictions[index] }
                .sortedBy { prediction -> prediction.distanceMeters ?: Int.MAX_VALUE }
            slots.forEachIndexed { position, slot -> ranked[slot] = nearestFirst[position] }
        }
        return ranked
    }

    /** For example "0.4 mi away"; nothing when the provider gave no distance. */
    fun distanceText(prediction: AddressAutocompletePrediction): String? {
        val meters = prediction.distanceMeters ?: return null
        val miles = TrailMilesTextSijko.milesText(meters.toDouble())
        return if (miles == "0.0") "Under 0.1 mi away" else "$miles mi away"
    }

    private fun nameKey(prediction: AddressAutocompletePrediction): String =
        prediction.primaryText.trim().lowercase()
}
