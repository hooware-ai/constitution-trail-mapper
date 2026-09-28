/**
 * Job: Derive where a route reverses, its leg order, and which pieces repeat earlier travel, from route geometry.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint

data class TrailRouteReversal(
    val point: MapPoint,
    val distanceAlongRouteMeters: Double,
)

data class TrailRouteTraversalPiece(
    /** Keeps the source segment's styling; its points cover one leg and one pass kind. */
    val segment: TrailRouteSegment,
    /** Zero-based; increases after each reversal. */
    val legIndex: Int,
    /** True when this stretch was already ridden earlier in the same route. */
    val repeatsEarlierTravel: Boolean,
    /** Navigation distance along the route at each of [segment]'s points. */
    val distancesAlongRouteMeters: List<Double>,
)

data class TrailRouteTraversalShape(
    val reversals: List<TrailRouteReversal>,
    val pieces: List<TrailRouteTraversalPiece>,
)

/**
 * A reversal is a U-turn on the same line: the route arrives at a vertex and leaves along the stretch it
 * just rode (the vertex before and after the turn are identical). Route geometry comes from shared graph
 * edges, so this pattern is exact, and it survives segment merging and saved-route JSON. Routes saved
 * before this analysis existed therefore need no migration. A crossing or a return on a nearby different
 * path is not a reversal.
 */
object TrailRouteTraversalShapeSijko {
    fun shapeFor(route: TrailRoute): TrailRouteTraversalShape {
        // Measure along the same drawable polylines navigation uses, including its short joins between
        // same-style segments, so a reversal's distance matches navigation progress at that point.
        val drawable = TrailRouteDrawableSegmentMergeSijko.merge(route.segments)
        val steps = drawable.flatMapIndexed { segmentIndex, segment -> stepsFor(segmentIndex, segment.points) }
        val reversals = mutableListOf<TrailRouteReversal>()
        val ridden = mutableSetOf<Pair<MapPoint, MapPoint>>()
        val pieces = mutableListOf<TrailRouteTraversalPiece>()
        var legIndex = 0
        var distanceMeters = 0.0
        var current: MutableList<MapPoint>? = null
        var currentDistances: MutableList<Double>? = null
        var currentKey: Triple<Int, Int, Boolean>? = null

        fun closePiece() {
            val points = current ?: return
            val distances = currentDistances ?: return
            val key = currentKey ?: return
            pieces += TrailRouteTraversalPiece(
                segment = drawable[key.first].copy(points = points.toList()),
                legIndex = key.second,
                repeatsEarlierTravel = key.third,
                distancesAlongRouteMeters = distances.toList(),
            )
            current = null
            currentDistances = null
            currentKey = null
        }

        steps.forEachIndexed { index, step ->
            val previous = steps.getOrNull(index - 1)
            if (previous != null && isUTurn(previous, step)) {
                reversals += TrailRouteReversal(point = step.from, distanceAlongRouteMeters = distanceMeters)
                legIndex += 1
            }
            val undirected = undirected(step.from, step.to)
            val key = Triple(step.segmentIndex, legIndex, undirected in ridden)
            ridden += undirected
            if (key != currentKey) {
                closePiece()
                current = mutableListOf(step.from)
                currentDistances = mutableListOf(distanceMeters)
                currentKey = key
            }
            current!! += step.to
            distanceMeters += step.navigationMeters
            currentDistances!! += distanceMeters
        }
        closePiece()
        return TrailRouteTraversalShape(reversals = reversals, pieces = pieces)
    }

    /**
     * The number of reversals [shapeFor] finds in a route with these segments, without building its
     * pieces. Route scoring uses it so a candidate is penalized for exactly the turnarounds riders see.
     */
    fun reversalCount(segments: List<TrailRouteSegment>): Int {
        return TrailRouteDrawableSegmentMergeSijko.merge(segments)
            .flatMapIndexed { segmentIndex, segment -> stepsFor(segmentIndex, segment.points) }
            .zipWithNext()
            .count { (previous, step) -> isUTurn(previous, step) }
    }

    /**
     * Splits [points] at every U-turn vertex, so no returned polyline doubles back on itself. Vertices
     * closer than navigation's minimum leg are collapsed first: a zero-length stub in the source data is
     * not a reversal, while a real U-turn around such a stub still is.
     */
    fun splitAtReversals(input: List<MapPoint>): List<List<MapPoint>> {
        val points = withoutDegenerateSteps(input)
        if (points.size < 3) {
            return listOf(points)
        }
        val pieces = mutableListOf<List<MapPoint>>()
        var start = 0
        for (index in 1 until points.lastIndex) {
            if (points[index - 1] == points[index + 1]) {
                pieces += points.subList(start, index + 1)
                start = index
            }
        }
        pieces += points.subList(start, points.size)
        return pieces
    }

    /**
     * Steps between vertices at least navigation's minimum leg apart, for U-turn detection. Each step keeps
     * the navigation length of the original legs it spans, so distances stay on navigation's exact basis.
     */
    private fun stepsFor(segmentIndex: Int, points: List<MapPoint>): List<Step> {
        val steps = mutableListOf<Step>()
        var from = points.firstOrNull() ?: return steps
        var spannedMeters = 0.0
        var previous = from
        points.drop(1).forEach { point ->
            val legMeters = TrailDistanceSijko.metersBetween(previous, point)
            if (legMeters >= NavigationMinimumLegMeters) {
                spannedMeters += legMeters
            }
            previous = point
            if (TrailDistanceSijko.metersBetween(from, point) >= NavigationMinimumLegMeters) {
                steps += Step(segmentIndex, from, point, spannedMeters)
                from = point
                spannedMeters = 0.0
            }
        }
        return steps
    }

    private fun withoutDegenerateSteps(points: List<MapPoint>): List<MapPoint> {
        val result = ArrayList<MapPoint>(points.size)
        points.forEach { point ->
            val last = result.lastOrNull()
            if (last == null || TrailDistanceSijko.metersBetween(last, point) >= NavigationMinimumLegMeters) {
                result += point
            }
        }
        return result
    }

    private fun isUTurn(previous: Step, step: Step): Boolean = previous.from == step.to && previous.to == step.from

    private fun undirected(first: MapPoint, second: MapPoint): Pair<MapPoint, MapPoint> {
        val firstComesFirst = first.latitude < second.latitude ||
            (first.latitude == second.latitude && first.longitude <= second.longitude)
        return if (firstComesFirst) first to second else second to first
    }


    private data class Step(val segmentIndex: Int, val from: MapPoint, val to: MapPoint, val navigationMeters: Double)

    // Matches TrailRouteNavigationSnapshotSijko, which drops shorter legs from its distance.
    private const val NavigationMinimumLegMeters = 0.1
}
