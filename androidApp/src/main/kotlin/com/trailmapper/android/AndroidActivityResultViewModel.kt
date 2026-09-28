/**
 * Job: Keep pending platform results across activity recreation and bind UI work to the current host.
 *
 */
package com.trailmapper.android

import androidx.activity.result.IntentSenderRequest
import androidx.lifecycle.ViewModel
import com.trailmapper.shared.MapPointSelectionResult
import com.trailmapper.shared.TrailAccountProvider
import com.trailmapper.shared.TrailAccountResult
import com.trailmapper.shared.TrailUserAccount
import com.trailmapper.shared.sijko.RouteEndpointTarget
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine

internal class AndroidActivityResultViewModel : ViewModel(), TrailAccountProvider {
    private val permissionResult = PendingActivityResult<Unit, Boolean>(false)
    private val settingsResult = PendingActivityResult<IntentSenderRequest, Boolean>(false)
    private val mapPointResult = PendingActivityResult<RouteEndpointTarget, MapPointSelectionResult>(
        MapPointSelectionResult.Cancelled,
    )
    private var hostOwner: Any? = null
    private var accountProvider: TrailAccountProvider? = null
    private var signInJob: Deferred<TrailAccountResult>? = null

    fun attach(
        owner: Any,
        launchPermissions: (Unit) -> Unit,
        launchSettings: (IntentSenderRequest) -> Unit,
        launchMapPoint: (RouteEndpointTarget) -> Unit,
        trailAccountProvider: TrailAccountProvider,
    ) {
        hostOwner = owner
        accountProvider = trailAccountProvider
        permissionResult.attach(launchPermissions)
        settingsResult.attach(launchSettings)
        mapPointResult.attach(launchMapPoint)
    }

    fun detach(owner: Any) {
        if (hostOwner !== owner) return
        hostOwner = null
        accountProvider = null
        permissionResult.detach()
        settingsResult.detach()
        mapPointResult.detach()
        // Credential Manager requires an Activity. End an in-flight sign-in before that host is destroyed.
        signInJob?.cancel()
    }

    suspend fun requestPermissions(): Boolean = permissionResult.request(Unit)

    suspend fun resolveLocationSettings(request: IntentSenderRequest): Boolean = settingsResult.request(request)

    suspend fun requestMapPoint(target: RouteEndpointTarget): MapPointSelectionResult = mapPointResult.request(target)

    fun completePermissions(granted: Boolean) = permissionResult.complete(granted)

    fun completeLocationSettings(resolved: Boolean) = settingsResult.complete(resolved)

    fun completeMapPoint(result: MapPointSelectionResult) = mapPointResult.complete(result)

    override suspend fun currentAccount(): TrailUserAccount? = accountProvider?.currentAccount()

    override suspend fun signIn(): TrailAccountResult = coroutineScope {
        val provider = accountProvider ?: return@coroutineScope TrailAccountResult.Unavailable
        val request = async { provider.signIn() }
        signInJob = request
        try {
            request.await()
        } catch (exception: CancellationException) {
            currentCoroutineContext().ensureActive()
            TrailAccountResult.Cancelled
        } finally {
            if (signInJob === request) signInJob = null
        }
    }

    override suspend fun signOut() {
        accountProvider?.signOut()
    }

    override fun onCleared() {
        hostOwner = null
        accountProvider = null
        permissionResult.clear()
        settingsResult.clear()
        mapPointResult.clear()
        signInJob?.cancel()
    }
}

/** A launched request keeps its result slot until delivery, even if its caller is cancelled. */
internal class PendingActivityResult<Input, Output>(private val unavailableResult: Output) {
    private class Request<Input, Output>(
        val input: Input,
        var continuation: CancellableContinuation<Output>?,
        var launched: Boolean = false,
    )

    private var launcher: ((Input) -> Unit)? = null
    private var pending: Request<Input, Output>? = null

    @Synchronized
    fun attach(launcher: (Input) -> Unit) {
        this.launcher = launcher
        launchPending()
    }

    @Synchronized
    fun detach() {
        launcher = null
    }

    suspend fun request(input: Input): Output = suspendCancellableCoroutine { continuation ->
        synchronized(this) {
            if (pending != null) {
                continuation.resume(unavailableResult)
                return@synchronized
            }
            val request = Request(input, continuation)
            pending = request
            continuation.invokeOnCancellation {
                synchronized(this) {
                    request.continuation = null
                    if (pending === request && !request.launched) pending = null
                }
            }
            launchPending()
        }
    }

    @Synchronized
    fun complete(result: Output) {
        val continuation = pending?.continuation
        pending = null
        continuation?.resume(result)
    }

    @Synchronized
    fun clear() {
        launcher = null
        val continuation = pending?.continuation
        pending = null
        continuation?.cancel()
    }

    private fun launchPending() {
        val request = pending?.takeUnless { it.launched } ?: return
        val launch = launcher ?: return
        request.launched = true
        try {
            launch(request.input)
        } catch (exception: Exception) {
            pending = null
            request.continuation?.resumeWithException(exception)
        }
    }
}
