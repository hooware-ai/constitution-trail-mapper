/**
 * Job: Keep relevant closure advice visible before a rider uses a new or saved route.
 */
package com.trailmapper.shared

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.trailmapper.shared.routing.TrailRouteAdvisory

@Composable
fun TrailRouteAdvisoryBanner(advisory: TrailRouteAdvisory, onReview: () -> Unit) {
    Surface(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onReview),
        shape = RoundedCornerShape(8.dp),
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(advisory.title, style = MaterialTheme.typography.titleSmall)
            Text("Reported closure in this work corridor. Route has not been detoured. Tap to review.", style = MaterialTheme.typography.bodySmall)
        }
    }
}
