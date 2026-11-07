package com.trailmapper.android

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.View
import android.view.Window
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowCompat
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import com.trailmapper.shared.trailMapperColorScheme

/** Apply status appearance to the owning dialog, never its activity or navigation bar. */
@Composable
internal fun TrailMapperDialogStatusAppearance(
    ownerLabel: String,
    protectStatusInset: Boolean = false,
    navigationProtectionColor: Color? = null,
) {
    val view = LocalView.current
    val window = findWindowOwnerInParents<Any, Window>(
        node = view,
        parentOf = { (it as? View)?.parent },
        windowOf = { (it as? DialogWindowProvider)?.window },
    )
    val appearance = dialogLightStatusOverride(Build.VERSION.SDK_INT)
    val navigationColor = navigationProtectionColor?.toArgb()
    DisposableEffect(window, appearance, protectStatusInset, navigationColor) {
        var protection: DialogInsetProtectionDrawable? = null
        var layoutListener: View.OnLayoutChangeListener? = null
        if (window != null && appearance != null) {
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            val beforeStatus = controller.isAppearanceLightStatusBars
            val beforeNavigation = controller.isAppearanceLightNavigationBars
            if (protectStatusInset || navigationColor != null) {
                val decor = window.decorView
                val drawable = DialogInsetProtectionDrawable(decor,
                    trailMapperColorScheme(true).background.toArgb(), protectStatusInset, navigationColor)
                drawable.setBounds(0, 0, decor.width, decor.height)
                decor.overlay.add(drawable)
                val listener = View.OnLayoutChangeListener { view, _, _, _, _, _, _, _, _ ->
                    drawable.setBounds(0, 0, view.width, view.height)
                    drawable.invalidateSelf()
                }
                decor.addOnLayoutChangeListener(listener)
                protection = drawable
                layoutListener = listener
            }
            controller.isAppearanceLightStatusBars = appearance
            if (BuildConfig.DEBUG) {
                Log.d("TrailMapperWindow", "t=${SystemClock.uptimeMillis()} owner=$ownerLabel " +
                    "windowId=${System.identityHashCode(window)} type=${window.attributes.type} " +
                    "statusBefore=$beforeStatus statusAfter=${controller.isAppearanceLightStatusBars} " +
                    "navBefore=$beforeNavigation navAfter=${controller.isAppearanceLightNavigationBars} " +
                    "navigationProtection=${navigationColor != null}")
            }
        } else if (BuildConfig.DEBUG && appearance != null) {
            Log.d("TrailMapperWindow", "t=${SystemClock.uptimeMillis()} owner=$ownerLabel noDialogWindowOwner")
        }
        // This effect owns only a disposable dialog window. Restoring flags while it closes could
        // introduce a final wrong-polarity frame; the activity's window has never been modified.
        onDispose {
            // Call sites are unconditional content of the owned sheet/dialog; they dispose when
            // that window is dismissed. No appearance restoration is sent to a closing window.
            if (window != null) {
                layoutListener?.let(window.decorView::removeOnLayoutChangeListener)
                protection?.let(window.decorView.overlay::remove)
            }
        }
    }
}

internal fun dialogLightStatusOverride(api: Int): Boolean? =
    if (api >= 35) usesDarkStatusIcons(api, darkTheme = false) else null

/** Find the nearest real provider; an activity/context is deliberately not a fallback. */
internal fun <N, W> findWindowOwnerInParents(
    node: N?,
    parentOf: (N) -> N?,
    windowOf: (N) -> W?,
): W? {
    var current = node
    while (current != null) {
        windowOf(current)?.let { return it }
        current = parentOf(current)
    }
    return null
}

/** Window-fixed protection remains above moving sheet content, including opening and closing. */
private class DialogInsetProtectionDrawable(
    private val decor: View,
    statusColor: Int,
    private val protectStatus: Boolean,
    navigationColor: Int?,
) : Drawable() {
    private val statusPaint = Paint().apply { color = statusColor }
    private val navigationPaint = navigationColor?.let { value -> Paint().apply { color = value } }
    override fun draw(canvas: Canvas) {
        val insets = ViewCompat.getRootWindowInsets(decor) ?: return
        fun edges(value: androidx.core.graphics.Insets) = SystemBarInsets(value.left, value.top, value.right, value.bottom)
        val status = if (protectStatus) edges(insets.getInsets(WindowInsetsCompat.Type.statusBars())) else SystemBarInsets(0,0,0,0)
        // Keep the system navigation region clear while visibility changes during the transition.
        val navigation = if (navigationPaint != null) {
            val bottom = insets.getInsetsIgnoringVisibility(WindowInsetsCompat.Type.navigationBars()).bottom
            // Directions' observed overlap is at the bottom handle; preserve side-navigation pixels.
            SystemBarInsets(0,0,0,bottom)
        } else SystemBarInsets(0,0,0,0)
        for (region in dialogProtectionRegions(bounds.width().toFloat(), bounds.height().toFloat(), status, navigation)) {
            val paint = if (region.status) statusPaint else navigationPaint ?: continue
            val rect = region.rect
            canvas.drawRect(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, paint)
        }
    }
    override fun setAlpha(alpha: Int) { statusPaint.alpha = alpha; navigationPaint?.alpha = alpha; invalidateSelf() }
    override fun setColorFilter(colorFilter: ColorFilter?) {
        statusPaint.colorFilter = colorFilter; navigationPaint?.colorFilter = colorFilter; invalidateSelf()
    }
    @Deprecated("Drawable opacity is no longer used")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}

internal data class DialogProtectionRegion(val rect: NavigationProtectionRect, val status: Boolean)
internal fun dialogProtectionRegions(width: Float, height: Float, status: SystemBarInsets, navigation: SystemBarInsets): List<DialogProtectionRegion> =
    navigationProtectionRects(width,height,navigation).map { DialogProtectionRegion(it,false) } +
        navigationProtectionRects(width,height,status).map { DialogProtectionRegion(it,true) }
