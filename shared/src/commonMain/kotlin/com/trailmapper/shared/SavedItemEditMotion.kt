/**
 * Job: Apply the bounded shake and shimmer treatment used by saved cards in edit mode.
 *
 */
package com.trailmapper.shared

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.trailmapper.shared.sijko.SavedItemEditMotionAvailabilitySijko
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch

@Composable
internal fun Modifier.savedItemEditMotion(active: Boolean): Modifier {
    if (!active) {
        return this
    }

    val shakeDp = remember { Animatable(0f) }
    val shimmerProgress = remember { Animatable(0f) }
    var motionEnabled by remember { mutableStateOf(false) }
    LaunchedEffect(active) {
        val durationScale = currentCoroutineContext()[MotionDurationScale]?.scaleFactor
        motionEnabled = SavedItemEditMotionAvailabilitySijko.shouldAnimate(durationScale)
        if (!active || !motionEnabled) {
            shakeDp.snapTo(0f)
            shimmerProgress.snapTo(0f)
            return@LaunchedEffect
        }

        shakeDp.snapTo(0f)
        shimmerProgress.snapTo(0f)
        coroutineScope {
            launch {
                shakeDp.animateTo(
                    targetValue = 0f,
                    animationSpec = keyframes {
                        durationMillis = 560
                        0f at 0
                        -2.5f at 70
                        2.5f at 140
                        -1.8f at 210
                        1.8f at 280
                        -1f at 350
                        1f at 420
                        0f at 490
                    },
                )
            }
            launch {
                shimmerProgress.animateTo(
                    targetValue = 1f,
                    animationSpec = tween(durationMillis = 1_500),
                )
            }
        }
    }
    val density = LocalDensity.current

    return this
        .graphicsLayer {
            translationX = if (motionEnabled) {
                with(density) { shakeDp.value.dp.toPx() }
            } else {
                0f
            }
            rotationZ = if (motionEnabled) shakeDp.value * 0.16f else 0f
        }
        .clip(RoundedCornerShape(8.dp))
        .drawWithContent {
            drawContent()
            if (!motionEnabled) {
                return@drawWithContent
            }
            val bandWidth = size.width * 0.22f
            val bandCenter = -bandWidth + (size.width + bandWidth * 2f) * shimmerProgress.value
            drawRect(
                brush = Brush.linearGradient(
                    colors = listOf(
                        Color.Transparent,
                        Color.White.copy(alpha = 0.08f),
                        Color.Transparent,
                    ),
                    start = Offset(bandCenter - bandWidth, 0f),
                    end = Offset(bandCenter + bandWidth, size.height),
                ),
            )
        }
}
