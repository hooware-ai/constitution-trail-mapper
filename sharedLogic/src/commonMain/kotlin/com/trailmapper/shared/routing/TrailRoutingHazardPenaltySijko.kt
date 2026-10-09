/**
 * Job: Add fixed route cost when traversed geometry enters a reviewed safety-hazard zone.
 *
 * Each visit to a hazard is bounded by two boundary events: a crossing of the hazard radius, or a
 * route endpoint inside it. Edges carry half of the fixed penalty per crossing, so one visit costs
 * one fixed penalty no matter how many graph edges the network splits it into. Endpoint halves are
 * charged only at route level; they are constant for a given start and destination, so they never
 * change which path an edge-cost search prefers.
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

object TrailRoutingHazardPenaltySijko {
    fun additionalCost(
        edge: TrailGraphEdge,
        hazards: List<TrailRoutingHazard> = TrailRoutingHazardCatalogSijko.hazards,
    ): Double {
        val points = edge.geometry()
        return hazards
            .asSequence()
            .filter(::isActive)
            .sumOf { hazard -> points.boundaryCrossings(hazard) * hazard.fixedPenalty / 2.0 }
    }

    /**
     * True when the edge's geometry comes within any hazard radius, including an edge wholly inside
     * one. Use this, not `additionalCost > 0`, to decide whether a route is hazard-free.
     */
    fun enters(
        edge: TrailGraphEdge,
        hazards: List<TrailRoutingHazard> = TrailRoutingHazardCatalogSijko.hazards,
    ): Boolean {
        val points = edge.geometry()
        return hazards.any { hazard ->
            isActive(hazard) &&
                (
                    points.any { point -> point.isInside(hazard) } ||
                        points.windowed(size = 2, step = 1).any { (start, end) ->
                            closestDistanceMeters(hazard, start, end) <= hazard.radiusMeters
                        }
                    )
        }
    }

    /**
     * Charges one fixed penalty per visit to each hazard along traversal-ordered [edges]. Gaps
     * between consecutive edges' geometry are walked as straight runs, so a junction that straddles
     * the radius still pairs its crossings.
     */
    fun routeCost(
        edges: List<TrailGraphEdge>,
        hazards: List<TrailRoutingHazard> = TrailRoutingHazardCatalogSijko.hazards,
    ): Double {
        val points = edges.flatMap { edge -> edge.geometry() }
        if (points.isEmpty()) {
            return 0.0
        }
        return hazards
            .asSequence()
            .filter(::isActive)
            .sumOf { hazard ->
                val boundaryEvents = points.boundaryCrossings(hazard) +
                    points.first().insideCount(hazard) +
                    points.last().insideCount(hazard)
                boundaryEvents / 2 * hazard.fixedPenalty
            }
    }

    private fun isActive(hazard: TrailRoutingHazard): Boolean {
        return hazard.radiusMeters > 0.0 && hazard.fixedPenalty > 0.0
    }

    private fun TrailGraphEdge.geometry(): List<MapPoint> {
        return routeSegments.flatMap { segment -> segment.points }
    }

    private fun List<MapPoint>.boundaryCrossings(hazard: TrailRoutingHazard): Int {
        return windowed(size = 2, step = 1).sumOf { (start, end) ->
            val startInside = start.isInside(hazard)
            val endInside = end.isInside(hazard)
            when {
                startInside != endInside -> 1
                startInside -> 0
                // Both ends outside: the straight run either dips through the radius or misses it.
                closestDistanceMeters(hazard, start, end) <= hazard.radiusMeters -> 2
                else -> 0
            }
        }
    }

    private fun MapPoint.insideCount(hazard: TrailRoutingHazard): Int {
        return if (isInside(hazard)) 1 else 0
    }

    private fun MapPoint.isInside(hazard: TrailRoutingHazard): Boolean {
        return TrailDistanceSijko.metersBetween(this, hazard.center) <= hazard.radiusMeters
    }

    private fun closestDistanceMeters(
        hazard: TrailRoutingHazard,
        start: MapPoint,
        end: MapPoint,
    ): Double {
        return TrailDistanceSijko.projectToSegment(
            point = hazard.center,
            segmentStart = start,
            segmentEnd = end,
        ).distanceMeters
    }
}
