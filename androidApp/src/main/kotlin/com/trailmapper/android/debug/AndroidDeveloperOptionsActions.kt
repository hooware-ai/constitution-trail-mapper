/**
 * Job: Implement Android-only debug actions for opening settings and revoking location permissions.
 *
 */
package com.trailmapper.android.debug

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.trailmapper.shared.DeveloperOptionsActions
import com.trailmapper.shared.sijko.ForegroundLocationGrantSijko
import com.trailmapper.shared.sijko.LocationPermissionRevokeDecisionSijko
import com.trailmapper.shared.sijko.LocationPermissionRevokeStatus
import kotlin.system.exitProcess

class AndroidDeveloperOptionsActions(
    private val activity: Activity,
) : DeveloperOptionsActions {
    override val locationPermissionRevokeStatus: LocationPermissionRevokeStatus
        get() = LocationPermissionRevokeDecisionSijko.status(
            supportsSelfRevocation = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU,
            hasForegroundLocationPermission = hasForegroundLocationPermission(),
        )

    override fun openAppSettings() {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", activity.packageName, null))
        activity.startActivity(intent)
    }

    override fun revokeLocationPermissions() {
        if (!canRevokeLocationPermissions) {
            if (locationPermissionRevokeStatus == LocationPermissionRevokeStatus.UnsupportedPlatform) {
                openAppSettings()
            }
            return
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.revokeSelfPermissionsOnKill(
                listOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
            )
            scheduleRelaunch()
            activity.finishAndRemoveTask()
            exitProcess(0)
        }
    }

    private fun scheduleRelaunch() {
        val launchIntent = activity.packageManager
            .getLaunchIntentForPackage(activity.packageName)
            ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            ?: return
        val pendingIntent = PendingIntent.getActivity(
            activity,
            0,
            launchIntent,
            PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val alarmManager = activity.getSystemService(AlarmManager::class.java)
        alarmManager.set(
            AlarmManager.ELAPSED_REALTIME,
            SystemClock.elapsedRealtime() + RELAUNCH_DELAY_MILLIS,
            pendingIntent,
        )
    }

    private fun hasForegroundLocationPermission(): Boolean {
        return ForegroundLocationGrantSijko.isGranted(
            fineGranted = ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.ACCESS_FINE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED,
            coarseGranted = ContextCompat.checkSelfPermission(
                activity,
                Manifest.permission.ACCESS_COARSE_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED,
        )
    }

    private companion object {
        const val RELAUNCH_DELAY_MILLIS = 1_000L
    }
}
