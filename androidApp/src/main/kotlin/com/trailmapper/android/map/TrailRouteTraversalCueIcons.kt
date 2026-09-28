/**
 * Job: Draw the color-independent bitmaps used for route direction, second passes, and turnaround markers.
 *
 */
package com.trailmapper.android.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface

internal object TrailRouteTraversalCueIcons {
    /**
     * A stamp repeated along the route line. The map lays the bitmap's top toward the start of the
     * polyline, so the chevrons point down the bitmap, toward the end, in the direction of travel.
     * A second pass uses two chevrons so it reads differently without color.
     */
    fun directionStamp(doubled: Boolean): Bitmap {
        val size = 48
        val bitmap = Bitmap.createBitmap(size, size * 2, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val chevronTops = if (doubled) listOf(20f, 44f) else listOf(32f)
        chevronTops.forEach { top ->
            val path = Path().apply {
                moveTo(10f, top)
                lineTo(24f, top + 16f)
                lineTo(38f, top)
            }
            canvas.drawPath(path, strokePaint(color = 0xCC000000.toInt(), width = 11f))
            canvas.drawPath(path, strokePaint(color = 0xFFFFFFFF.toInt(), width = 6f))
        }
        return bitmap
    }

    /** A labeled turnaround sign: a U-turn glyph plus "Turn around", readable without color. */
    fun turnaroundMarker(density: Float): Bitmap {
        val text = "Turn around"
        val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFF212121.toInt()
            textSize = 13f * density
            typeface = Typeface.DEFAULT_BOLD
        }
        val padding = 6f * density
        val glyph = 18f * density
        val width = (padding * 3 + glyph + textPaint.measureText(text)).toInt()
        val height = (padding * 2 + glyph).toInt()
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val frame = RectF(1f * density, 1f * density, width - 1f * density, height - 1f * density)
        canvas.drawRoundRect(frame, 6f * density, 6f * density, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt() })
        canvas.drawRoundRect(frame, 6f * density, 6f * density, strokePaint(color = 0xFF212121.toInt(), width = 2f * density))

        // U-turn: up the right side, over the top, down the left side, ending in an arrowhead.
        val left = padding + glyph * 0.2f
        val right = padding + glyph * 0.8f
        val top = padding + glyph * 0.25f
        val bottom = padding + glyph
        val uTurn = Path().apply {
            moveTo(right, bottom)
            lineTo(right, top + (right - left) / 2f)
            arcTo(RectF(left, top, right, top + (right - left)), 0f, -180f)
            lineTo(left, bottom - glyph * 0.15f)
        }
        val glyphPaint = strokePaint(color = 0xFF212121.toInt(), width = 2.5f * density)
        canvas.drawPath(uTurn, glyphPaint)
        val head = Path().apply {
            moveTo(left - glyph * 0.18f, bottom - glyph * 0.35f)
            lineTo(left, bottom - glyph * 0.12f)
            lineTo(left + glyph * 0.18f, bottom - glyph * 0.35f)
        }
        canvas.drawPath(head, glyphPaint)
        canvas.drawText(text, padding * 2 + glyph, height / 2f - (textPaint.ascent() + textPaint.descent()) / 2f, textPaint)
        return bitmap
    }

    private fun strokePaint(color: Int, width: Float) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        style = Paint.Style.STROKE
        strokeWidth = width
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
}
