/**
 * Job: Decide whether fine and coarse permission states are enough for foreground location access.
 *
 */
package com.trailmapper.shared.sijko

object ForegroundLocationGrantSijko {
    fun isGranted(fineGranted: Boolean, coarseGranted: Boolean): Boolean {
        return fineGranted || coarseGranted
    }
}
