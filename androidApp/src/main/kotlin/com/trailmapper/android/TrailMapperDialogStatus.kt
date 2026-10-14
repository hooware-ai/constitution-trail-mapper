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
import androidx.compose.ui.graphics.toArgb
import com.trailmapper.shared.trailMapperColorScheme

/** Apply status appearance to the owning dialog, never its activity or navigation bar. */
@Composable
internal fun TrailMapperDialogStatusAppearance(ownerLabel: String, protectStatusInset: Boolean = false) {
    val view = LocalView.current
    val window = findWindowOwnerInParents<Any, Window>(
        node = view,
        parentOf = { (it as? View)?.parent },
        windowOf = { (it as? DialogWindowProvider)?.window },
    )
    val appearance = dialogLightStatusOverride(Build.VERSION.SDK_INT)
    DisposableEffect(window, appearance, protectStatusInset) {
        var protection: DialogStatusProtectionDrawable? = null
        var layoutListener: View.OnLayoutChangeListener? = null
        if (window != null && appearance != null) {
            val controller = WindowCompat.getInsetsController(window, window.decorView)
            val beforeStatus = controller.isAppearanceLightStatusBars
            val beforeNavigation = controller.isAppearanceLightNavigationBars
            if (protectStatusInset) {
                val decor = window.decorView
                val drawable = DialogStatusProtectionDrawable(decor, trailMapperColorScheme(true).background.toArgb())
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
                    "navBefore=$beforeNavigation navAfter=${controller.isAppearanceLightNavigationBars}")
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

/** Paint above sheet pixels in this window, including when Expanded reaches y=0. */
private class DialogStatusProtectionDrawable(private val decor: View, color: Int) : Drawable() {
    private val paint = Paint().apply { this.color = color }
    override fun draw(canvas: Canvas) {
        val inset = ViewCompat.getRootWindowInsets(decor)?.getInsets(WindowInsetsCompat.Type.statusBars()) ?: return
        val edges = SystemBarInsets(inset.left, inset.top, inset.right, inset.bottom)
        for (rect in navigationProtectionRects(bounds.width().toFloat(), bounds.height().toFloat(), edges)) {
            canvas.drawRect(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height, paint)
        }
    }
    override fun setAlpha(alpha: Int) { paint.alpha = alpha; invalidateSelf() }
    override fun setColorFilter(colorFilter: ColorFilter?) { paint.colorFilter = colorFilter; invalidateSelf() }
    @Deprecated("Drawable opacity is no longer used")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
