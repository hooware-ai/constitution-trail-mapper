/**
 * Job: Verify the Account sheet states and that its copy never promises sync or backup.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.TrailUserAccount
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrailAccountSheetSijkoTest {
    private val account = TrailUserAccount(id = "1", displayName = "Rider", email = "rider@example.com", profileImageUrl = null)

    @Test
    fun signedOutWithNothingToReportShowsOnlyTheSignInChoice() {
        assertEquals(
            TrailAccountSheetContent.SignedOut(problem = null, notice = null),
            TrailAccountSheetSijko.contentFor(account = null, isResolvingAccount = false, message = null),
        )
    }

    @Test
    fun aFailureIsShownAsAProblemToRetry() {
        assertEquals(
            TrailAccountSheetContent.SignedOut(problem = "Sign-in failed.", notice = null),
            TrailAccountSheetSijko.contentFor(null, false, "Sign-in failed."),
        )
    }

    @Test
    fun signingOutIsANoticeNotAProblem() {
        assertEquals(
            TrailAccountSheetContent.SignedOut(problem = null, notice = TrailAccountSheetSijko.SIGNED_OUT_NOTICE),
            TrailAccountSheetSijko.contentFor(null, false, TrailAccountSheetSijko.SIGNED_OUT_NOTICE),
        )
    }

    @Test
    fun waitingOnGoogleShowsSigningInAndHidesOldProblems() {
        assertEquals(
            TrailAccountSheetContent.InProgress(TrailAccountSheetSijko.SIGNING_IN_LABEL),
            TrailAccountSheetSijko.contentFor(account = null, isResolvingAccount = true, message = "Sign-in failed."),
        )
    }

    @Test
    fun aPendingSignOutSaysSigningOutNotSigningIn() {
        assertEquals(
            TrailAccountSheetContent.InProgress(TrailAccountSheetSijko.SIGNING_OUT_LABEL),
            TrailAccountSheetSijko.contentFor(account = account, isResolvingAccount = true, message = null),
        )
    }

    @Test
    fun signedInShowsTheAccountEvenWithASuccessMessageAround() {
        assertEquals(
            TrailAccountSheetContent.SignedIn(account),
            TrailAccountSheetSijko.contentFor(account, false, "Signed in as Rider."),
        )
    }

    @Test
    fun resultsGoToHomeOnlyWhenTheSheetIsClosed() {
        assertNull(TrailAccountSheetSijko.homeMessageFor("Sign-in failed.", sheetOpen = true))
        assertEquals("Sign-in failed.", TrailAccountSheetSijko.homeMessageFor("Sign-in failed.", sheetOpen = false))
        assertNull(TrailAccountSheetSijko.homeMessageFor(null, sheetOpen = false))
    }

    @Test
    fun copyKeepsRoutesOnThisDeviceAndPromisesNoSyncOrBackup() {
        val note = TrailAccountSheetSijko.LOCAL_DATA_NOTE
        assertTrue("stay on this device" in note)
        assertTrue("does not back them up or sync them" in note)
        assertTrue("optional" in note)
        assertTrue("on this device" in TrailAccountSheetSijko.SIGNED_OUT_NOTICE)
    }
}
