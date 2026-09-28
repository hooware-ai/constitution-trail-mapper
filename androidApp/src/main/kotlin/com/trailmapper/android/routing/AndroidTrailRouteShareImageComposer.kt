/**
 * Job: Compose a lossless, branded, attributed trail-route PNG from an open basemap snapshot.
 *
 */
package com.trailmapper.android.routing

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.compose.ui.graphics.toArgb
import com.trailmapper.android.R
import com.trailmapper.android.map.TrailRouteTraversalCueIcons
import com.trailmapper.android.map.polylineBaseColor
import com.trailmapper.android.map.polylineBasePattern
import com.trailmapper.android.map.polylineOverlayColor
import com.trailmapper.android.map.polylineOverlayWidth
import com.trailmapper.android.map.polylineWidth
import com.trailmapper.android.map.polylineZIndex
import com.trailmapper.shared.SavedTrailRoute
import com.trailmapper.shared.routing.TrailRouteAdvisorySijko
import com.trailmapper.shared.routing.TrailRouteTraversalShapeSijko
import com.trailmapper.shared.routing.TrailRouteSegment
import com.trailmapper.shared.sijko.MapPoint
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.snapshotter.MapSnapshot

object AndroidTrailRouteShareImageComposer {
    fun compose(
        context: Context,
        snapshot: MapSnapshot,
        savedRoute: SavedTrailRoute,
    ): Bitmap {
        val mapBitmap = snapshot.bitmap.copy(Bitmap.Config.ARGB_8888, true)
            ?: error("The route basemap could not be copied.")
        val shape = TrailRouteTraversalShapeSijko.shapeFor(savedRoute.route)
        val pieces = shape.pieces
            .filter { piece -> piece.segment.points.size >= MINIMUM_SEGMENT_POINT_COUNT }
            .map { piece ->
                val pixels = piece.segment.points.map { point -> snapshot.pixelFor(point) }
                DrawnPiece(
                    segment = piece.segment,
                    // As on the route map, a second pass is drawn beside the first, here a line's width apart.
                    pixels = if (piece.repeatsEarlierTravel) {
                        TrailRouteShareCueGeometry.offsetToTheRight(pixels, SECOND_PASS_OFFSET_PIXELS)
                    } else {
                        pixels
                    },
                    repeatsEarlierTravel = piece.repeatsEarlierTravel,
                )
            }

        Canvas(mapBitmap).apply {
            pieces
                .sortedBy { piece -> piece.segment.polylineZIndex() }
                .forEach { piece -> drawRouteSegment(piece) }
            pieces
                .filter { piece -> piece.segment.polylineOverlayColor() != null }
                .sortedBy { piece -> piece.segment.polylineZIndex() }
                .forEach { piece -> drawRouteOverlay(piece) }
            // Color-independent cues: chevrons face travel, doubled on a second pass.
            pieces.forEach { piece ->
                TrailRouteShareCueGeometry.chevronsAlong(piece.pixels, CHEVRON_SPACING_PIXELS).forEach { chevron ->
                    drawChevron(chevron, doubled = piece.repeatsEarlierTravel)
                }
            }
            if (shape.reversals.isNotEmpty()) {
                val turnaroundMarker = TrailRouteTraversalCueIcons.turnaroundMarker(TURNAROUND_MARKER_DENSITY)
                shape.reversals.forEach { reversal ->
                    val pixel = snapshot.pixelFor(reversal.point)
                    drawBitmap(
                        turnaroundMarker,
                        pixel.x - turnaroundMarker.width / 2f,
                        pixel.y - turnaroundMarker.height / 2f,
                        Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
                    )
                }
                turnaroundMarker.recycle()
            }

            val routePoints = savedRoute.route.segments.flatMap(TrailRouteSegment::points)
            routePoints.firstOrNull()?.let { point ->
                drawEndpointMarker(snapshot, point, "S", START_MARKER_COLOR)
            }
            routePoints.lastOrNull()?.let { point ->
                drawEndpointMarker(snapshot, point, "D", DESTINATION_MARKER_COLOR)
            }
            drawMapAttribution()
        }

        val advisoryLayouts = advisoryLayoutsFor(savedRoute, mapBitmap.width)
        val advisoryFooterHeight = if (advisoryLayouts.isEmpty()) {
            0
        } else {
            ADVISORY_VERTICAL_PADDING_PIXELS * 2 + advisoryLayouts.sumOf { it.height } +
                ADVISORY_TEXT_GAP_PIXELS * (advisoryLayouts.size - 1)
        }
        val image = Bitmap.createBitmap(
            mapBitmap.width,
            mapBitmap.height + HEADER_HEIGHT_PIXELS + advisoryFooterHeight,
            Bitmap.Config.ARGB_8888,
        )
        Canvas(image).apply {
            drawColor(HEADER_BACKGROUND_COLOR)
            drawHeader(
                context = context,
                title = savedRoute.title,
                summary = savedRoute.summary,
                imageWidth = image.width,
            )
            drawBitmap(mapBitmap, 0f, HEADER_HEIGHT_PIXELS.toFloat(), null)
            if (advisoryLayouts.isNotEmpty()) {
                drawAdvisoryFooter(
                    layouts = advisoryLayouts,
                    top = HEADER_HEIGHT_PIXELS + mapBitmap.height,
                    footerHeight = advisoryFooterHeight,
                )
            }
            drawRect(
                0f,
                HEADER_HEIGHT_PIXELS - HEADER_ACCENT_HEIGHT_PIXELS,
                image.width.toFloat(),
                HEADER_HEIGHT_PIXELS.toFloat(),
                Paint(Paint.ANTI_ALIAS_FLAG).apply { color = HEADER_ACCENT_COLOR },
            )
        }
        mapBitmap.recycle()
        return image
    }

    private fun advisoryLayoutsFor(savedRoute: SavedTrailRoute, imageWidth: Int): List<StaticLayout> {
        val textWidth = imageWidth - HEADER_SIDE_PADDING_PIXELS * 2
        return TrailRouteAdvisorySijko.forRoute(savedRoute.route).flatMap { advisory ->
            listOf(
                advisoryTextLayout(advisory.title, textWidth, ADVISORY_TITLE_SIZE_PIXELS, Typeface.BOLD),
                advisoryTextLayout(advisory.message, textWidth, ADVISORY_BODY_SIZE_PIXELS, Typeface.NORMAL),
                advisoryTextLayout(advisory.sourceUrl, textWidth, ADVISORY_SOURCE_SIZE_PIXELS, Typeface.NORMAL),
            )
        }
    }

    private fun advisoryTextLayout(text: String, width: Int, textSize: Float, textStyle: Int): StaticLayout {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ADVISORY_TEXT_COLOR
            this.textSize = textSize
            typeface = Typeface.create(Typeface.DEFAULT, textStyle)
        }
        // Measure every line before allocating the PNG: warnings must not be
        // ellipsized into the fixed header or drawn over basemap attribution.
        return StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setIncludePad(false)
            .build()
    }

    private fun Canvas.drawAdvisoryFooter(layouts: List<StaticLayout>, top: Int, footerHeight: Int) {
        drawRect(
            0f,
            top.toFloat(),
            width.toFloat(),
            (top + footerHeight).toFloat(),
            Paint().apply { color = ADVISORY_BACKGROUND_COLOR },
        )
        drawRect(
            0f,
            top.toFloat(),
            width.toFloat(),
            top + HEADER_ACCENT_HEIGHT_PIXELS,
            Paint().apply { color = ADVISORY_ACCENT_COLOR },
        )
        var textTop = top + ADVISORY_VERTICAL_PADDING_PIXELS
        layouts.forEach { layout ->
            save()
            translate(HEADER_SIDE_PADDING_PIXELS.toFloat(), textTop.toFloat())
            layout.draw(this)
            restore()
            textTop += layout.height + ADVISORY_TEXT_GAP_PIXELS
        }
    }

    private fun Canvas.drawRouteSegment(piece: DrawnPiece) {
        val segment = piece.segment
        drawPath(
            piece.toPath(),
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = segment.polylineBaseColor().toArgb()
                style = Paint.Style.STROKE
                strokeWidth = segment.polylineWidth()
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
                pathEffect = segment.polylineBasePattern()?.let {
                    DashPathEffect(EXPORT_DASH_PATTERN, 0f)
                }
            },
        )
    }

    private fun Canvas.drawRouteOverlay(piece: DrawnPiece) {
        val segment = piece.segment
        val overlayColor = segment.polylineOverlayColor() ?: return
        drawPath(
            piece.toPath(),
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = overlayColor.toArgb()
                style = Paint.Style.STROKE
                strokeWidth = segment.polylineOverlayWidth()
                strokeCap = Paint.Cap.ROUND
                strokeJoin = Paint.Join.ROUND
                pathEffect = DashPathEffect(EXPORT_DASH_PATTERN, 0f)
            },
        )
    }

    private fun DrawnPiece.toPath(): Path {
        return Path().apply {
            pixels.forEachIndexed { index, pixel ->
                if (index == 0) {
                    moveTo(pixel.x, pixel.y)
                } else {
                    lineTo(pixel.x, pixel.y)
                }
            }
        }
    }

    /** A chevron pointing along travel: white with a dark outline, so it reads on any line color. */
    private fun Canvas.drawChevron(chevron: ShareChevron, doubled: Boolean) {
        val centers = if (doubled) listOf(-CHEVRON_GAP_PIXELS / 2f, CHEVRON_GAP_PIXELS / 2f) else listOf(0f)
        save()
        translate(chevron.x, chevron.y)
        rotate(chevron.angleDegrees)
        centers.forEach { center ->
            val path = Path().apply {
                moveTo(center - CHEVRON_HALF_SIZE_PIXELS, -CHEVRON_HALF_SIZE_PIXELS)
                lineTo(center + CHEVRON_HALF_SIZE_PIXELS / 2f, 0f)
                lineTo(center - CHEVRON_HALF_SIZE_PIXELS, CHEVRON_HALF_SIZE_PIXELS)
            }
            drawPath(path, chevronPaint(CHEVRON_OUTLINE_COLOR, CHEVRON_OUTLINE_WIDTH_PIXELS))
            drawPath(path, chevronPaint(Color.WHITE, CHEVRON_STROKE_WIDTH_PIXELS))
        }
        restore()
    }

    private fun chevronPaint(color: Int, width: Float) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        style = Paint.Style.STROKE
        strokeWidth = width
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    private fun MapSnapshot.pixelFor(point: MapPoint): SharePixel {
        val pixel = pixelForLatLng(point.toMapLibreLatLng())
        return SharePixel(pixel.x, pixel.y)
    }

    private data class DrawnPiece(
        val segment: TrailRouteSegment,
        val pixels: List<SharePixel>,
        val repeatsEarlierTravel: Boolean,
    )

    private fun Canvas.drawEndpointMarker(
        snapshot: MapSnapshot,
        point: MapPoint,
        label: String,
        markerColor: Int,
    ) {
        val pixel = snapshot.pixelForLatLng(point.toMapLibreLatLng())
        drawCircle(
            pixel.x,
            pixel.y,
            ENDPOINT_MARKER_RADIUS_PIXELS,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                style = Paint.Style.FILL
            },
        )
        drawCircle(
            pixel.x,
            pixel.y,
            ENDPOINT_MARKER_RADIUS_PIXELS - ENDPOINT_MARKER_BORDER_PIXELS,
            Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = markerColor
                style = Paint.Style.FILL
            },
        )
        val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textAlign = Paint.Align.CENTER
            textSize = ENDPOINT_MARKER_TEXT_SIZE_PIXELS
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val verticalCenter = pixel.y - (labelPaint.ascent() + labelPaint.descent()) / 2f
        drawText(label, pixel.x, verticalCenter, labelPaint)
    }

    private fun Canvas.drawMapAttribution() {
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ATTRIBUTION_TEXT_COLOR
            textSize = ATTRIBUTION_TEXT_SIZE_PIXELS
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
        }
        val textWidth = textPaint.measureText(MAP_ATTRIBUTION)
        val left = width - textWidth - ATTRIBUTION_HORIZONTAL_PADDING_PIXELS * 2f - ATTRIBUTION_MARGIN_PIXELS
        val top = height - ATTRIBUTION_TEXT_SIZE_PIXELS - ATTRIBUTION_VERTICAL_PADDING_PIXELS * 2f -
            ATTRIBUTION_MARGIN_PIXELS
        val right = width - ATTRIBUTION_MARGIN_PIXELS
        val bottom = height - ATTRIBUTION_MARGIN_PIXELS
        drawRoundRect(
            RectF(left, top, right, bottom),
            ATTRIBUTION_CORNER_RADIUS_PIXELS,
            ATTRIBUTION_CORNER_RADIUS_PIXELS,
            Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ATTRIBUTION_BACKGROUND_COLOR },
        )
        drawText(
            MAP_ATTRIBUTION,
            left + ATTRIBUTION_HORIZONTAL_PADDING_PIXELS,
            bottom - ATTRIBUTION_VERTICAL_PADDING_PIXELS - textPaint.descent(),
            textPaint,
        )
    }

    private fun Canvas.drawHeader(
        context: Context,
        title: String,
        summary: String,
        imageWidth: Int,
    ) {
        BitmapFactory.decodeResource(context.resources, R.drawable.trail_mapper_logo)?.let { logo ->
            drawBitmap(
                logo,
                null,
                Rect(
                    HEADER_SIDE_PADDING_PIXELS,
                    HEADER_LOGO_TOP_PIXELS,
                    HEADER_SIDE_PADDING_PIXELS + HEADER_LOGO_SIZE_PIXELS,
                    HEADER_LOGO_TOP_PIXELS + HEADER_LOGO_SIZE_PIXELS,
                ),
                Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
            )
            logo.recycle()
        }

        val textLeft = HEADER_SIDE_PADDING_PIXELS + HEADER_LOGO_SIZE_PIXELS + HEADER_TEXT_GAP_PIXELS
        val textWidth = imageWidth - textLeft - HEADER_SIDE_PADDING_PIXELS
        drawTextBlock(
            text = title,
            paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                color = HEADER_TITLE_COLOR
                textSize = HEADER_TITLE_SIZE_PIXELS
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            },
            left = textLeft,
            top = HEADER_TITLE_TOP_PIXELS,
            width = textWidth,
            maximumLines = 1,
        )
        drawTextBlock(
            text = summary,
            paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                color = HEADER_SUMMARY_COLOR
                textSize = HEADER_SUMMARY_SIZE_PIXELS
                typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
            },
            left = textLeft,
            top = HEADER_SUMMARY_TOP_PIXELS,
            width = textWidth,
            maximumLines = 3,
        )
    }

    private fun Canvas.drawTextBlock(
        text: String,
        paint: TextPaint,
        left: Int,
        top: Int,
        width: Int,
        maximumLines: Int,
    ) {
        save()
        translate(left.toFloat(), top.toFloat())
        StaticLayout.Builder
            .obtain(text, 0, text.length, paint, width)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setIncludePad(false)
            .setMaxLines(maximumLines)
            .setEllipsize(android.text.TextUtils.TruncateAt.END)
            .build()
            .draw(this)
        restore()
    }

    private fun MapPoint.toMapLibreLatLng(): LatLng = LatLng(latitude, longitude)

    private val EXPORT_DASH_PATTERN = floatArrayOf(36f, 24f)
    private const val MINIMUM_SEGMENT_POINT_COUNT = 2
    private const val SECOND_PASS_OFFSET_PIXELS = 22f
    private const val CHEVRON_SPACING_PIXELS = 110f
    private const val CHEVRON_HALF_SIZE_PIXELS = 9f
    private const val CHEVRON_GAP_PIXELS = 12f
    private const val CHEVRON_STROKE_WIDTH_PIXELS = 4f
    private const val CHEVRON_OUTLINE_WIDTH_PIXELS = 8f
    private const val TURNAROUND_MARKER_DENSITY = 3f
    private const val HEADER_HEIGHT_PIXELS = 320
    private const val HEADER_ACCENT_HEIGHT_PIXELS = 10f
    private const val HEADER_SIDE_PADDING_PIXELS = 56
    private const val HEADER_LOGO_TOP_PIXELS = 54
    private const val HEADER_LOGO_SIZE_PIXELS = 210
    private const val HEADER_TEXT_GAP_PIXELS = 44
    private const val HEADER_TITLE_TOP_PIXELS = 56
    private const val HEADER_SUMMARY_TOP_PIXELS = 142
    private const val HEADER_TITLE_SIZE_PIXELS = 64f
    private const val HEADER_SUMMARY_SIZE_PIXELS = 34f
    private const val ADVISORY_VERTICAL_PADDING_PIXELS = 40
    private const val ADVISORY_TEXT_GAP_PIXELS = 18
    private const val ADVISORY_TITLE_SIZE_PIXELS = 38f
    private const val ADVISORY_BODY_SIZE_PIXELS = 32f
    private const val ADVISORY_SOURCE_SIZE_PIXELS = 28f
    private const val ENDPOINT_MARKER_RADIUS_PIXELS = 34f
    private const val ENDPOINT_MARKER_BORDER_PIXELS = 6f
    private const val ENDPOINT_MARKER_TEXT_SIZE_PIXELS = 32f
    private const val ATTRIBUTION_TEXT_SIZE_PIXELS = 24f
    private const val ATTRIBUTION_HORIZONTAL_PADDING_PIXELS = 16f
    private const val ATTRIBUTION_VERTICAL_PADDING_PIXELS = 10f
    private const val ATTRIBUTION_MARGIN_PIXELS = 18f
    private const val ATTRIBUTION_CORNER_RADIUS_PIXELS = 8f
    private const val MAP_ATTRIBUTION =
        "OpenFreeMap | © OpenMapTiles | Data © OpenStreetMap contributors"
    private val HEADER_BACKGROUND_COLOR = Color.rgb(249, 251, 249)
    private val HEADER_ACCENT_COLOR = Color.rgb(10, 128, 108)
    private val HEADER_TITLE_COLOR = Color.rgb(25, 32, 30)
    private val HEADER_SUMMARY_COLOR = Color.rgb(78, 91, 87)
    private val ADVISORY_BACKGROUND_COLOR = Color.rgb(255, 244, 220)
    private val ADVISORY_ACCENT_COLOR = Color.rgb(206, 112, 25)
    private val ADVISORY_TEXT_COLOR = Color.rgb(99, 60, 13)
    private val START_MARKER_COLOR = Color.rgb(10, 128, 108)
    private val DESTINATION_MARKER_COLOR = Color.rgb(218, 33, 40)
    private val ATTRIBUTION_TEXT_COLOR = Color.rgb(45, 52, 50)
    private val ATTRIBUTION_BACKGROUND_COLOR = Color.argb(225, 255, 255, 255)
    private val CHEVRON_OUTLINE_COLOR = Color.argb(204, 0, 0, 0)
}
