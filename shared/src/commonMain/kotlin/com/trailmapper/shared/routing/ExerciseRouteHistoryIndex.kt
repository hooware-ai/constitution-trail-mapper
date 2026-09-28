/**
 * Job: Match current traversals to completed exercise history by road geometry rather than upstream ids.
 *
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.CompletedExerciseSession
import com.trailmapper.shared.sijko.MapPoint
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Traversal keys are `source#geometry`, and upstream refreshes can renumber the source or re-digitize
 * and re-split the geometry of an unchanged road. History is matched in two tiers:
 * 1. identical geometry, whatever the source id, with the same per-key length rule as before;
 * 2. otherwise the share of the edge lying within [CoverageToleranceMeters] of, and roughly parallel
 *    to, the session's traveled geometry.
 * Keys without geometry fall back to exact matching. Saved keys already embed their coordinates, so
 * sessions recorded before this matching need no migration.
 */
internal class ExerciseRouteHistoryIndex private constructor(
    private val sessions: List<IndexedSession>,
    private val grid: Map<Long, List<IndexedSegment>>,
    private val longitudeScale: Double,
) {
    private val coverageByIdentity = mutableMapOf<String, Coverage>()

    val isEmpty: Boolean get() = sessions.isEmpty()

    /** Recency-weighted meters of [traversalEdges] already ridden in the indexed sessions. */
    fun overlapMeters(traversalEdges: List<TrailRouteTraversalEdge>): Double {
        if (sessions.isEmpty()) {
            return 0.0
        }
        val current = ExerciseRouteOverlapSijko.effectiveTraversal(traversalEdges).groupBy { identityFor(it.key) }
        return sessions.indices.sumOf { sessionIndex ->
            val session = sessions[sessionIndex]
            current.entries.sumOf { (identity, edges) ->
                val currentMeters = edges.sumOf { it.distanceMeters }
                val completedMeters = session.lengthsByIdentity[identity]
                if (completedMeters != null) {
                    min(currentMeters, completedMeters)
                } else {
                    val coverage = coverage(identity, edges.first().key)
                    min(currentMeters * coverage.shares[sessionIndex], coverage.matchingMeters[sessionIndex])
                }
            } * session.recency
        }
    }

    /** Recency-weighted share of the road behind [key] ridden in the indexed sessions. */
    fun weightFor(key: String): Double {
        if (sessions.isEmpty()) {
            return 0.0
        }
        val identity = identityFor(key)
        return sessions.indices.sumOf { sessionIndex ->
            val session = sessions[sessionIndex]
            val share = if (identity in session.lengthsByIdentity) 1.0 else coverage(identity, key).shares[sessionIndex]
            share * session.recency
        }
    }

    private fun coverage(identity: String, key: String): Coverage {
        return coverageByIdentity.getOrPut(identity) { computeCoverage(key) }
    }

    private fun computeCoverage(key: String): Coverage {
        val covered = DoubleArray(sessions.size)
        val matchingIdentities = Array(sessions.size) { mutableSetOf<String>() }
        val points = geometryFor(key)?.map { project(it, longitudeScale) }
            ?: return Coverage(covered, DoubleArray(sessions.size))
        var totalMeters = 0.0
        val coveredSessions = BooleanArray(sessions.size)
        points.zipWithNext().forEach { (start, end) ->
            val dx = end.x - start.x
            val dy = end.y - start.y
            val lengthMeters = sqrt(dx * dx + dy * dy)
            if (lengthMeters < MinimumPieceMeters) {
                return@forEach
            }
            val pieces = ceil(lengthMeters / SampleSpacingMeters).toInt()
            val pieceMeters = lengthMeters / pieces
            repeat(pieces) { piece ->
                val ratio = (piece + 0.5) / pieces
                val x = start.x + dx * ratio
                val y = start.y + dy * ratio
                coveredSessions.fill(false)
                nearbySegments(x, y).forEach { segment ->
                    if (!coveredSessions[segment.sessionIndex] && segment.covers(x, y, dx / lengthMeters, dy / lengthMeters)) {
                        coveredSessions[segment.sessionIndex] = true
                        covered[segment.sessionIndex] += pieceMeters
                        matchingIdentities[segment.sessionIndex] += segment.identity
                    }
                }
                totalMeters += pieceMeters
            }
        }
        if (totalMeters > 0.0) {
            covered.indices.forEach { covered[it] /= totalMeters }
        }
        val matchingMeters = DoubleArray(sessions.size) { sessionIndex ->
            matchingIdentities[sessionIndex].sumOf { sessions[sessionIndex].lengthsByIdentity.getValue(it) }
        }
        return Coverage(covered, matchingMeters)
    }

    private fun nearbySegments(x: Double, y: Double): Sequence<IndexedSegment> {
        val cellX = floor(x / CellMeters).toLong()
        val cellY = floor(y / CellMeters).toLong()
        return sequence {
            for (offsetX in -1L..1L) {
                for (offsetY in -1L..1L) {
                    grid[cellKey(cellX + offsetX, cellY + offsetY)]?.let { yieldAll(it) }
                }
            }
        }
    }


    private class IndexedSession(
        val recency: Double,
        val lengthsByIdentity: Map<String, Double>,
    )

    private class Coverage(val shares: DoubleArray, val matchingMeters: DoubleArray)

    private data class ProjectedPoint(val x: Double, val y: Double)

    private class IndexedSegment(
        val sessionIndex: Int,
        val identity: String,
        val start: ProjectedPoint,
        val end: ProjectedPoint,
    ) {
        private val dx = end.x - start.x
        private val dy = end.y - start.y
        private val lengthMeters = sqrt(dx * dx + dy * dy)

        /** Within tolerance, projecting onto the segment's span, and roughly parallel to [unitX], [unitY]. */
        fun covers(x: Double, y: Double, unitX: Double, unitY: Double): Boolean {
            val alongMeters = ((x - start.x) * dx + (y - start.y) * dy) / lengthMeters
            if (alongMeters < -EndSlackMeters || alongMeters > lengthMeters + EndSlackMeters) {
                return false
            }
            val acrossMeters = abs((x - start.x) * dy - (y - start.y) * dx) / lengthMeters
            if (acrossMeters > CoverageToleranceMeters) {
                return false
            }
            return abs(unitX * dx + unitY * dy) / lengthMeters >= MinimumHeadingCosine
        }
    }

    companion object {
        fun build(
            completedSessions: List<CompletedExerciseSession>,
            nowEpochMillis: Long,
        ): ExerciseRouteHistoryIndex {
            val referenceLatitude = completedSessions.asSequence()
                .flatMap { it.traversalEdges.asSequence() }
                .firstNotNullOfOrNull { geometryFor(it.key)?.firstOrNull()?.latitude } ?: 0.0
            val longitudeScale = cos(referenceLatitude * PI / 180.0)
            val grid = mutableMapOf<Long, MutableList<IndexedSegment>>()
            val sessions = completedSessions.mapIndexed { sessionIndex, session ->
                val effective = ExerciseRouteOverlapSijko.effectiveTraversal(session.traversalEdges)
                effective.map { it.key }.distinct().forEach { key ->
                    val points = geometryFor(key) ?: return@forEach
                    points.zipWithNext().forEach { (start, end) ->
                        val segment = IndexedSegment(
                            sessionIndex = sessionIndex,
                            identity = identityFor(key),
                            start = project(start, longitudeScale),
                            end = project(end, longitudeScale),
                        )
                        if (segment.start != segment.end) {
                            insert(grid, segment)
                        }
                    }
                }
                IndexedSession(
                    recency = ExerciseRouteHistoryRecencySijko.weight(
                        completedAtEpochMillis = session.completedAtEpochMillis,
                        nowEpochMillis = nowEpochMillis,
                    ),
                    lengthsByIdentity = effective
                        .groupBy { identityFor(it.key) }
                        .mapValues { (_, edges) -> edges.sumOf { it.distanceMeters } },
                )
            }
            return ExerciseRouteHistoryIndex(sessions, grid, longitudeScale)
        }

        /** The geometry part of a key, shared by every source id; keys without geometry stay whole. */
        fun identityFor(key: String): String {
            val geometry = key.substringAfterLast(KeySeparator, missingDelimiterValue = "")
            return if (geometry.isEmpty() || geometry == UnknownGeometry) key else "$KeySeparator$geometry"
        }

        private fun geometryFor(key: String): List<MapPoint>? {
            val identity = identityFor(key)
            if (!identity.startsWith(KeySeparator)) {
                return null
            }
            return identity.drop(1).split(';').map { coordinate ->
                val parts = coordinate.split(',')
                if (parts.size != 2) {
                    return null
                }
                val latitude = parts[0].toLongOrNull() ?: return null
                val longitude = parts[1].toLongOrNull() ?: return null
                MapPoint(latitude / CoordinateScale, longitude / CoordinateScale)
            }.takeIf { it.size >= 2 }
        }

        /** Local equirectangular meters; the indexed area spans a few kilometers. */
        private fun project(point: MapPoint, longitudeScale: Double): ProjectedPoint {
            return ProjectedPoint(
                x = point.longitude * MetersPerDegree * longitudeScale,
                y = point.latitude * MetersPerDegree,
            )
        }

        private fun insert(grid: MutableMap<Long, MutableList<IndexedSegment>>, segment: IndexedSegment) {
            val minX = floor(minOf(segment.start.x, segment.end.x) / CellMeters).toLong()
            val maxX = floor(maxOf(segment.start.x, segment.end.x) / CellMeters).toLong()
            val minY = floor(minOf(segment.start.y, segment.end.y) / CellMeters).toLong()
            val maxY = floor(maxOf(segment.start.y, segment.end.y) / CellMeters).toLong()
            for (cellX in minX..maxX) {
                for (cellY in minY..maxY) {
                    grid.getOrPut(cellKey(cellX, cellY)) { mutableListOf() } += segment
                }
            }
        }

        private fun cellKey(cellX: Long, cellY: Long): Long = (cellX shl 32) xor (cellY and 0xFFFFFFFFL)

        private const val KeySeparator = "#"
        private const val UnknownGeometry = "unknown"
        private const val CoordinateScale = 10_000_000.0
        private const val MetersPerDegree = 111_320.0
        private const val CellMeters = 25.0
        private const val SampleSpacingMeters = 5.0
        private const val MinimumPieceMeters = 0.01
        private const val CoverageToleranceMeters = 10.0
        private const val EndSlackMeters = 2.0
        // cos(30 degrees): crossing and diverging roads do not count as the same road.
        private const val MinimumHeadingCosine = 0.866
    }
}
