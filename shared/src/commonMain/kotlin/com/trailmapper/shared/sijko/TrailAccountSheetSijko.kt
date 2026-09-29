/**
 * Job: Decide what the Account sheet shows and say plainly what signing in does and does not do today.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.TrailUserAccount

sealed interface TrailAccountSheetContent {
    /** Waiting on Google; the sheet shows progress and no action to press. */
    data object SigningIn : TrailAccountSheetContent

    /** [problem] is a failure to explain; [notice] is neutral news such as having signed out. */
    data class SignedOut(
        val problem: String?,
        val notice: String?,
    ) : TrailAccountSheetContent

    data class SignedIn(val account: TrailUserAccount) : TrailAccountSheetContent
}

object TrailAccountSheetSijko {
    const val TITLE = "Account"

    /** Shown wherever sign-in is offered or active. It must stay true to what sign-in does today. */
    const val LOCAL_DATA_NOTE =
        "Signing in is optional. Your saved routes and places stay on this device, " +
            "and signing in does not back them up or sync them."

    const val SIGNED_OUT_NOTICE = "Signed out. Your saved routes and places are still on this device."

    const val PRIVACY_LINK_LABEL = "How Trail Mapper handles your data"

    fun contentFor(
        account: TrailUserAccount?,
        isResolvingAccount: Boolean,
        message: String?,
    ): TrailAccountSheetContent = when {
        isResolvingAccount -> TrailAccountSheetContent.SigningIn
        account != null -> TrailAccountSheetContent.SignedIn(account)
        message == SIGNED_OUT_NOTICE -> TrailAccountSheetContent.SignedOut(problem = null, notice = message)
        else -> TrailAccountSheetContent.SignedOut(problem = message, notice = null)
    }

    /** With the sheet open the result is shown in it; otherwise it goes to a brief message on Home. */
    fun homeMessageFor(
        message: String?,
        sheetOpen: Boolean,
    ): String? = message.takeUnless { sheetOpen }
}
