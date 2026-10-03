/**
 * Job: Prove the Willow closure and the Camelback crossing block on the UNCHANGED actual native/county trail asset.
 *
 * Needs the private, ignored data/generated/mcgis-trails.normalized.json (the native asset). Like the other real-data
 * tests it fails, rather than skips, when the asset is missing, and every route a control relies on is asserted to exist
 * first: a control that finds no route proves nothing and fails.
 */
package com.trailmapper.shared.routing

import com.trailmapper.shared.sijko.MapPoint
import com.trailmapper.shared.sijko.RouteLayerDefaultsSijko
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

class TimedClosureRealDataTest {
    private val closure = TrailRouteClosureSijko.willowTrailCrossing
    private val camelback = TrailRouteClosureSijko.camelbackCrossing
    private val features by lazy(::loadFeatures)
    private val trail1305 get() = features.single { it.id == "54:1305" }
    private val raw get() = trail1305.paths[0]
    private val willowStart get() = closure.activeFromEpochMillis
    private val willowEstimate get() = assertNotNull(closure.estimatedEndEpochMillis)

    /** The same network in the four orders the review asked for: feature order and raw path direction, both ways. */
    private fun variants(): List<Pair<String, List<TrailNetworkFeature>>> {
        val reversedRaw = features.map { feature ->
            if (feature.id == "54:1305") feature.copy(paths = feature.paths.map { it.reversed() }) else feature
        }
        return listOf(
            "asset order" to features,
            "reversed feature order" to features.reversed(),
            "reversed raw path" to reversedRaw,
            "reversed raw path and feature order" to reversedRaw.reversed(),
        )
    }

    @Test
    fun theRawSourceLegIsUnchangedAndTheClosureBoundsLieInsideIt() {
        // Vertices 97 and 98 exactly as the closure-mapping brief recorded them from the licensed source.
        assertPoint(raw[97], 40.5096012799, -88.9843690241)
        assertPoint(raw[98], 40.5166840740, -88.9849653323)
        assertTrue(TrailDistanceSijko.metersBetween(raw[97], raw[98]) in 789.0..791.0)
        listOf(closure.closedFrom, closure.closedTo).forEach { bound ->
            val onLeg = TrailDistanceSijko.projectToSegment(bound, raw[97], raw[98])
            assertTrue(onLeg.distanceMeters < 0.5, "bound is ${onLeg.distanceMeters} m off the real leg")
            assertTrue(TrailDistanceSijko.metersBetween(raw[97], bound) > 100.0)
            assertTrue(TrailDistanceSijko.metersBetween(raw[98], bound) > 100.0)
        }
        assertTrue(TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo) in 201.5..203.5)
    }

    @Test
    fun theCutClipsInsideTheRealLegInEveryOrderKeepsBothPortionsAndTouchesNothingElse() {
        variants().forEach { (name, original) ->
            val before = TrailRouteClosureSijko.openFeatures(original, willowStart - 1)
            assertTrue(before.appliedClosures.none { it.id == closure.id }, name)
            val cut = TrailRouteClosureSijko.openFeatures(original, willowStart)
            assertTrue(closure in cut.appliedClosures, name)
            // Both the Uptown closure (vertex bounds) and Willow (projected bounds) are active on the same feature.
            assertTrue(TrailRouteClosureSijko.uptownUnderpass in cut.appliedClosures, name)
            val changed = cut.features.filterIndexed { index, feature -> feature != original[index] }
            assertEquals(listOf("54:1305"), changed.map { it.id }, name)
            val pieces = changed.single().paths
            val south = pieces.first { it.last() == closure.closedFrom || it.first() == closure.closedFrom }
            val north = pieces.first { it.first() == closure.closedTo || it.last() == closure.closedTo }
            // Each residual ends exactly at its bound and is made of unchanged source vertices; nothing was inserted.
            val sourcePoints = original.single { it.id == "54:1305" }.paths.flatten().toSet()
            listOf(south, north).forEach { piece ->
                piece.filter { it != closure.closedFrom && it != closure.closedTo }
                    .forEach { assertTrue(it in sourcePoints, "$name: a vertex that is not in the source") }
            }
            // The kept portions of the leg are about 388 m and 200 m; only the 202.5 m section is gone from it.
            assertTrue(
                TrailDistanceSijko.metersBetween(raw[97], closure.closedFrom) in 380.0..395.0 &&
                    TrailDistanceSijko.metersBetween(closure.closedTo, raw[98]) in 195.0..205.0,
            )
            // The explicitly identified neighbors and crossing are untouched.
            listOf("16:188", "54:2578", "54:4349", "16:297", "16:1297", "16:1348").forEach { id ->
                assertEquals(original.single { it.id == id }, cut.features.single { it.id == id }, "$name $id")
            }
        }
        // The input is exactly what was loaded: nothing was edited, no vertex was inserted.
        assertEquals(loadFeatures(), features)
    }

    @Test
    fun bothResidualPortionsStayRoutableAndGateFree() {
        variants().forEach { (name, network) ->
            derivedLegs = derivedOf(network)
            val southern = assertNotNull(find(network, raw[97], closure.closedFrom, willowStart), "$name southern")
            val northern = assertNotNull(find(network, closure.closedTo, raw[98], willowStart), "$name northern")
            listOf(southern, northern).forEach { route ->
                assertTrue(gated(route, willowStart).isEmpty(), name)
                assertTrue(TrailRouteAdvisorySijko.forRoute(route, willowStart).none { it.id == closure.id }, name)
            }
            // The northern approach reaches the junction at vertex 98 where 54:2578 / 54:4349 / Hidden Creek meet.
            listOf("54:4349" to 0, "54:2578" to 2, "16:1348" to 0).forEach { (id, pathIndex) ->
                val path = network.single { it.id == id }.paths[pathIndex]
                val route = assertNotNull(find(network, path.first(), path.last(), willowStart), "$name route on $id")
                assertTrue(gated(route, willowStart).isEmpty(), "$name $id is not gated")
            }
        }
    }

    @Test
    fun shortRoutesWhollyInsideTheSectionAreGatedOnTheActualPathAtEveryLengthInBothDirections() {
        val legMeters = TrailDistanceSijko.metersBetween(raw[97], raw[98])
        variants().forEach { (name, network) ->
            derivedLegs = derivedOf(network)
            var refused = 0
            val first = pointAlong(0.6 * legMeters)
            listOf(1.0, 5.0, 10.0, 14.0, 16.0, 30.0, 150.0).forEach { meters ->
                val other = pointAlong(0.6 * legMeters + meters)
                listOf(first to other, other to first).forEach { (from, to) ->
                    val route = assertNotNull(find(network, from, to, willowStart - 1), "$name $meters m route exists")
                    assertTrue(gated(route, willowStart - 1).isEmpty(), "$name open before at $meters m")
                    if (assertGateRefuses(route, willowStart, "$name gated at the instant, $meters m")) {
                        refused++
                        assertEquals(listOf(closure.id), gated(route, willowEstimate + 1), "$name gated after the estimate, $meters m")
                    }
                    // Every one of these starts or ends inside the section, so recalculation has no way around it.
                    val outcome = TrailRouteClosureGateSijko.recalculate(network, route, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = willowStart, derived = derivedLegs)
                    assertTrue(outcome is TrailRouteRecalculationOutcome.NoSafeRoute, "$name $meters m recalculation gave $outcome")
                    assertTrue(closure in (outcome as TrailRouteRecalculationOutcome.NoSafeRoute).blockingClosures, name)
                }
            }
            // Not vacuous. Where the planner routes on the trail (the asset's own order, and a reversed raw path) the gate
            // itself must refuse the routes. With the features reordered, the planner answers EVERY route that starts
            // mid-leg with estimated access hops (a pre-existing planner behavior, independent of closures); those are
            // refused by the estimated-gap rule and counted apart here.
            if (name == "asset order" || name == "reversed raw path") {
                assertTrue(refused >= 10, "$name: the closure gate refused only $refused short routes")
            }
        }
    }

    @Test
    fun partialPenetrationAtEitherBoundaryOnTheActualPathIsGatedButApproachesThatStopAtABoundAreNot() {
        val south = TrailDistanceSijko.metersBetween(raw[97], closure.closedFrom)
        val north = south + TrailDistanceSijko.metersBetween(closure.closedFrom, closure.closedTo)
        variants().forEach { (name, network) ->
            derivedLegs = derivedOf(network)
            fun routeOf(from: Double, to: Double) =
                assertNotNull(find(network, pointAlong(from), pointAlong(to), willowStart - 1), "$name $from to $to")
            val penetrating = listOf(
                routeOf(south - 4.0, south + 3.0), routeOf(south + 3.0, south - 4.0),
                routeOf(north - 3.0, north + 4.0), routeOf(north + 4.0, north - 3.0),
                routeOf(south - 25.0, north + 25.0), routeOf(north + 25.0, south - 25.0),
            )
            val refusedHere = penetrating.count { assertGateRefuses(it, willowStart, name) }
            if (name == "asset order" || name == "reversed raw path") {
                assertTrue(refusedHere >= 4, "$name: the gate refused only $refusedHere penetrating routes")
            }
            // Where the graph moved a node, the planner's chord is the raw leg stretched toward the anchor, and the bound is
            // carried onto it by fraction: a tap on the raw bound lands up to a few meters from the carried one, so there
            // the approach is judged 15 m short of the bound (the exact bound-ending controls on carried bounds are in the
            // synthetic tests). Everywhere else the approach ends exactly at the bound.
            val shy = if (derivedLegs.any { it.closureId == closure.id }) 15.0 else 0.0
            listOf(
                routeOf(south - 30.0, south - shy), routeOf(south - shy, south - 30.0), routeOf(south - 30.0, south - shy - 0.3),
                routeOf(north + shy, north + 30.0), routeOf(north + 30.0, north + shy), routeOf(north + shy + 0.3, north + 30.0),
            ).forEach { route -> assertTrue(gated(route, willowStart).isEmpty(), "$name residual approach is not section travel") }
        }
    }

    @Test
    fun routesPlannedFromMapPickerPointsOnTheActualPathAreGatedWhereverTheGraphNodesAnchorTheirLine() {
        // The app plans from the points its map picker returns: projected onto the loaded network's own node-anchored
        // line, which in some feature orders is a chord a few meters off the raw leg. Each route here is positively
        // Start-eligible before the closure (no estimated hop, an ordinary gate) and must be refused from the instant.
        val legMeters = TrailDistanceSijko.metersBetween(raw[97], raw[98])
        var derived = 0
        var eligible = 0
        variants().forEach { (name, network) ->
            derivedLegs = derivedOf(network)
            val graph = TrailGraphBuilderSijko.buildGraph(network)
            fun mapped(point: MapPoint) = assertNotNull(NearestTrailSnapSijko.nearestSnap(graph, point)).projectedPoint
            val first = mapped(pointAlong(0.6 * legMeters))
            listOf(1.0, 5.0, 10.0, 14.0, 16.0, 30.0, 150.0).forEach { meters ->
                val other = mapped(pointAlong(0.6 * legMeters + meters))
                listOf(first to other, other to first).forEach { (from, to) ->
                    val route = assertNotNull(find(network, from, to, willowStart - 1), "$name $meters m route exists")
                    assertTrue(!estimatedGap(route), "$name $meters m: a zero-gap route")
                    assertTrue(route.edges.isNotEmpty() && route.edges.all { it.sourceFeatureId == "54:1305" }, "$name $meters m is on the source feature")
                    assertTrue(gated(route, willowStart - 1).isEmpty(), "$name $meters m: eligible before the closure")
                    eligible++
                    if (route.segments.flatMap { it.points }.any { TrailDistanceSijko.projectToSegment(it, raw[97], raw[98]).distanceMeters > 0.5 }) {
                        derived++
                    }
                    assertEquals(listOf(closure.id), gated(route, willowStart), "$name map-picker route, $meters m, at the instant")
                    assertEquals(listOf(closure.id), gated(route, willowEstimate + 1), "$name map-picker route, $meters m, after the estimate")
                    val outcome = TrailRouteClosureGateSijko.recalculate(network, route, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = willowStart, derived = derivedLegs)
                    assertTrue(outcome is TrailRouteRecalculationOutcome.NoSafeRoute, "$name $meters m recalculation gave $outcome")
                    assertTrue(closure in (outcome as TrailRouteRecalculationOutcome.NoSafeRoute).blockingClosures, name)
                }
            }
        }
        assertEquals(variants().size * 14, eligible)
        // Not vacuous: some of these really do ride a chord that leaves the raw leg, where a raw-line check would miss them.
        assertTrue(derived >= 10, "only $derived map-picker routes followed a node-anchored chord")
    }

    @Test
    fun mapPickerRoutesAcrossTheCamelbackCrossingAreGatedInEveryOrder() {
        val start = camelback.activeFromEpochMillis
        val end = assertNotNull(camelback.estimatedEndEpochMillis)
        variants().forEach { (name, network) ->
            derivedLegs = derivedOf(network)
            val graph = TrailGraphBuilderSijko.buildGraph(network)
            fun mapped(point: MapPoint) = assertNotNull(NearestTrailSnapSijko.nearestSnap(graph, point)).projectedPoint
            fun beside(meters: Double) =
                MapPoint(camelback.closedFrom.latitude + meters / 111_194.93, camelback.closedFrom.longitude)
            // From just short of the crossing to just beyond it, and from either side of vertex 7. A route the planner answers
            // with an estimated hop is refused separately (the bridge never starts one) and is counted apart.
            var eligible = 0
            listOf(
                beside(-15.0) to beside(40.0), beside(40.0) to beside(-15.0), beside(-4.0) to beside(4.0),
                beside(-15.0) to beside(15.0), beside(15.0) to beside(-15.0), beside(-4.0) to beside(15.0),
            ).forEach { (a, b) ->
                val route = assertNotNull(find(network, mapped(a), mapped(b), start - 1), "$name map-picker Camelback route exists")
                if (estimatedGap(route)) return@forEach
                eligible++
                assertTrue(gated(route, start - 1).isEmpty(), "$name eligible before")
                listOf(start, end + 1).forEach { now ->
                    assertEquals(listOf(camelback.id), gated(route, now), "$name map-picker Camelback route at $now")
                }
            }
            assertTrue(eligible >= 2, "$name: only $eligible zero-gap map-picker routes crossed Camelback")
        }
    }

    @Test
    fun aRoutePlannedBeforeTheClosureIsGatedAtItsInstantAndAfterTheEstimate() {
        val planned = assertNotNull(find(features, raw[97], raw[98], willowStart - 1))
        assertTrue(
            planned.segments.any { segment ->
                segment.points.zipWithNext().any { (a, b) ->
                    TrailDistanceSijko.projectToSegment(closure.closedFrom, a, b).distanceMeters < 1.0
                }
            },
            "the earlier route does ride the section",
        )
        assertTrue(gated(planned, willowStart - 1).isEmpty())
        assertTrue(
            TrailRouteAdvisorySijko.forRoute(planned, willowStart - 1).single { it.id == closure.id }.message
                .startsWith("Scheduled, not closed yet"),
        )
        assertEquals(listOf(closure.id), gated(planned, willowStart))
        assertEquals(listOf(closure.id), gated(planned, willowEstimate))
        val after = TrailRouteClosureGateSijko.blockingAdvisories(planned, willowEstimate + 1)
        assertEquals(listOf(closure.id), after.map { it.id })
        assertTrue(after.single().message.contains("has passed; reopening has not been confirmed"))
    }

    @Test
    fun theActualCypressCrossingIsUsableAndNotGatedInEveryOrder() {
        val cypress = features.single { it.id == "16:188" }
        assertEquals(setOf(TrailNetworkRole.SharedRoadways), cypress.routeRoles)
        val path = cypress.paths.single()
        val index = path.indexOfFirst { TrailDistanceSijko.metersBetween(it, closure.closedFrom) < 1.0 }
        assertTrue(index in 1 until path.lastIndex, "the actual crossing vertex is within a meter of the south bound")
        variants().forEach { (name, network) ->
            derivedLegs = derivedOf(network)
            listOf(path[index - 2] to path[index + 3], path[index + 3] to path[index - 2], path.first() to path.last()).forEach { (from, to) ->
                listOf(willowStart - 1, willowStart + 1, willowEstimate + 1).forEach { now ->
                    val route = assertNotNull(find(network, from, to, now), "$name crossing route at $now")
                    assertTrue(route.edges.any { it.sourceFeatureId == "16:188" }, "$name the route uses the crossing feature")
                    assertTrue(
                        route.segments.flatMap { it.points }.any { TrailDistanceSijko.metersBetween(it, closure.closedFrom) < 1.0 },
                        "$name the route really crosses at the south bound",
                    )
                    assertTrue(gated(route, now).isEmpty(), "$name perpendicular crossing at $now")
                }
            }
        }
    }

    @Test
    fun camelbackBlocksStartOnTheActualTrailFromItsInstantInBothDirectionsAndEveryOrder() {
        val start = camelback.activeFromEpochMillis
        val end = assertNotNull(camelback.estimatedEndEpochMillis)
        assertPoint(raw[7], 40.4982765696, -88.9834168982)
        // The crossing is on leg 6 to 7 of the actual path.
        assertTrue(TrailDistanceSijko.projectToSegment(camelback.closedFrom, raw[6], raw[7]).distanceMeters < 1.0)
        variants().forEach { (name, network) ->
            derivedLegs = derivedOf(network)
            listOf(raw[6] to raw[8], raw[8] to raw[6], raw[3] to raw[12]).forEach { (from, to) ->
                val route = assertNotNull(find(network, from, to, start - 1), "$name route exists")
                assertTrue(gated(route, start - 1).isEmpty(), "$name open before")
                assertTrue(assertNotNull(camel(route, start - 1), name).message.startsWith("Scheduled, not closed yet"))
                listOf(start, start + 1, end, end + 1, end + 30 * 86_400_000L).forEach { now ->
                    assertEquals(listOf(camelback.id), gated(route, now), "$name blocked at $now")
                    assertNotNull(find(network, from, to, now), "$name the preview still exists at $now")
                }
                val outcome = TrailRouteClosureGateSijko.recalculate(
                    network, route, TrailRouteRerouteAccess.NotAvailable, nowEpochMillis = start,
                )
                assertTrue(outcome is TrailRouteRecalculationOutcome.NoSafeRoute, "$name recalculation: $outcome")
            }
            // Routes that do not traverse the crossing are unaffected: short of it, beyond it, and elsewhere.
            listOf(raw[0] to raw[5], raw[9] to raw[14]).forEach { (from, to) ->
                val route = assertNotNull(find(network, from, to, start), "$name unaffected route exists")
                assertTrue(
                    route.segments.flatMap { it.points }.all { TrailDistanceSijko.metersBetween(it, camelback.closedFrom) > 3.0 },
                    "$name the control stays clear of the crossing",
                )
                assertTrue(gated(route, start).isEmpty(), "$name unaffected route is not gated")
            }
            // The road that crosses there and its neighbor are not closed.
            // The road that runs by the crossing: a hop along it, using only that feature's edges, is not the trail.
            val road = network.single { it.id == "16:297" }.paths.first { path ->
                path.any { TrailDistanceSijko.metersBetween(it, camelback.closedFrom) < 40.0 }
            }
            val nearest = road.indices.minBy { TrailDistanceSijko.metersBetween(road[it], camelback.closedFrom) }
            val along = assertNotNull(
                find(network, road[maxOf(0, nearest - 1)], road[minOf(road.lastIndex, nearest + 1)], start),
                "$name a hop along 16:297 by the crossing",
            )
            val onTrail = along.edges.any { it.sourceFeatureId == "54:1305" }
            if (name == "asset order") {
                assertTrue(along.edges.isNotEmpty() && along.edges.all { it.sourceFeatureId == "16:297" }, "$name uses only the road")
            }
            // A route that stays on the road is not the trail and is not blocked; one the planner chose to put on the trail is.
            if (!onTrail) assertTrue(gated(along, start).isEmpty(), "$name the road is not gated by Camelback")
        }
    }

    @Test
    fun theScheduledCamelbackNoticeDoesNotPromiseStartWhileUptownAndWillowAlreadyRefuseTheActualRoute() {
        val between = willowStart + 3_600_000L // October 5, 12:00Z: Uptown and Willow in force, Camelback scheduled
        assertTrue(between < camelback.activeFromEpochMillis)
        // Planned before any of the notices (the Uptown detour began on September 21).
        val beforeAll = TrailRouteClosureSijko.uptownUnderpass.activeFromEpochMillis - 1
        val route = assertNotNull(find(features, raw[6], raw[98], beforeAll))
        assertTrue(gated(route, beforeAll).isEmpty())
        val refusedBy = gated(route, between)
        assertTrue(closure.id in refusedBy && TrailRouteClosureSijko.uptownUnderpass.id in refusedBy, "refused by $refusedBy")
        val notice = assertNotNull(camel(route, between)).message
        assertTrue(notice.startsWith("Scheduled, not closed yet"))
        assertTrue(!notice.contains("can still be started"), notice)
        assertTrue(notice.contains("this closure does not stop Trail Mapper from starting a route (other closures and checks may)"))
    }

    @Test
    fun theCrossingClosureCutsNothingOnTheActualFeatureAndBothClosuresAreActiveTogether() {
        val now = camelback.activeFromEpochMillis
        val active = TrailRouteClosureSijko.openFeatures(features, now)
        assertTrue(camelback !in active.appliedClosures)
        assertTrue(closure in active.appliedClosures && TrailRouteClosureSijko.uptownUnderpass in active.appliedClosures)
        // Camelback's vicinity (vertices 0 to 5 and 8 onward before the Uptown cut) is not cut by it.
        val pieces = active.features.single { it.id == "54:1305" }.paths
        assertTrue(pieces.any { it.contains(raw[6]) && it.contains(raw[7]) && it.contains(raw[8]) })
    }

    /**
     * A route with an estimated (unrouted) access hop is refused separately: the bridge never starts a route with an
     * estimated gap. In some feature orders the planner answers a very short route that way, so such a route is counted
     * apart; every other route must be refused by the closure gate itself.
     */
    private fun estimatedGap(route: TrailRoute) =
        route.segments.any { it.type == TrailRouteSegmentType.Access && !it.isRouted }

    /** Asserts the closure gate refuses [route] at [now] unless it is separately non-startable; returns whether it was. */
    private fun assertGateRefuses(route: TrailRoute, now: Long, label: String): Boolean {
        if (estimatedGap(route)) return false
        assertEquals(listOf(closure.id), gated(route, now), label)
        return true
    }

    // Where the loaded graph's derived geometry stands for a closure's source leg (what a front end with the graph passes).
    private var derivedLegs: List<TrailRouteDerivedClosureLeg> = emptyList()

    private fun derivedOf(network: List<TrailNetworkFeature>) =
        TrailRouteClosureDerivationSijko.legsFor(TrailGraphBuilderSijko.buildGraph(network))

    private fun gated(route: TrailRoute, now: Long) =
        TrailRouteClosureGateSijko.blockingAdvisories(route, now, derivedLegs).map { it.id }

    private fun camel(route: TrailRoute, now: Long) =
        TrailRouteAdvisorySijko.forRoute(route, now).singleOrNull { it.id == camelback.id }

    private fun pointAlong(meters: Double): MapPoint {
        val fraction = meters / TrailDistanceSijko.metersBetween(raw[97], raw[98])
        return MapPoint(
            latitude = raw[97].latitude + (raw[98].latitude - raw[97].latitude) * fraction,
            longitude = raw[97].longitude + (raw[98].longitude - raw[97].longitude) * fraction,
        )
    }

    private fun find(network: List<TrailNetworkFeature>, from: MapPoint, to: MapPoint, now: Long) =
        TrailRouteCalculationSijko.findRoute(
            features = network,
            routeLayers = RouteLayerDefaultsSijko.defaultSelection(),
            startPoint = from,
            destinationPoint = to,
            accessGraph = null,
            nowEpochMillis = now,
        )

    private fun assertPoint(point: MapPoint, latitude: Double, longitude: Double) {
        assertEquals(latitude, point.latitude, 1e-9)
        assertEquals(longitude, point.longitude, 1e-9)
    }

    private fun loadFeatures(): List<TrailNetworkFeature> {
        val root = Json.parseToJsonElement(assetFile().readText()).jsonObject
        return root.getValue("layers").jsonArray.flatMap { layer ->
            layer.jsonObject.getValue("features").jsonArray.map { element ->
                val feature = element.jsonObject
                TrailNetworkFeature(
                    id = feature.getValue("id").jsonPrimitive.content,
                    name = feature["name"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content,
                    status = if (feature["status"]?.jsonPrimitive?.content == "Proposed") {
                        TrailFeatureStatus.Proposed
                    } else {
                        TrailFeatureStatus.Existing
                    },
                    routeRoles = roles(feature),
                    facilityType = TrailFacilityType.UrbanTrail,
                    comfortLevel = TrailComfortLevel.AllAgesAndAbilities,
                    paths = paths(feature),
                )
            }
        }
    }

    private fun roles(feature: JsonObject): Set<TrailNetworkRole> {
        val element = feature.getValue("routeRoles")
        val names = if (element is JsonArray) element.map { it.jsonPrimitive.content } else listOf(element.jsonPrimitive.content)
        return names.map { TrailNetworkRole.valueOf(it) }.toSet()
    }

    private fun paths(feature: JsonObject): List<List<MapPoint>> = feature.getValue("paths").jsonArray.map { path ->
        path.jsonArray.map { pair ->
            val coordinate = pair.jsonArray
            MapPoint(latitude = coordinate[1].jsonPrimitive.double, longitude = coordinate[0].jsonPrimitive.double)
        }
    }

    private fun assetFile(): File {
        var directory = File(requireNotNull(System.getProperty("user.dir"))).absoluteFile
        repeat(5) {
            val candidate = directory.resolve("data/generated/mcgis-trails.normalized.json")
            if (candidate.isFile) return candidate
            directory = directory.parentFile ?: return@repeat
        }
        error("Unable to locate data/generated/mcgis-trails.normalized.json from ${System.getProperty("user.dir")}")
    }
}
