/**
 * Job: Sign users into Trail Mapper with Google through Android Credential Manager.
 *
 */
package com.trailmapper.android.account

import android.content.Context
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import com.trailmapper.android.BuildConfig
import com.trailmapper.shared.TrailAccountProvider
import com.trailmapper.shared.TrailAccountResult
import com.trailmapper.shared.TrailUserAccount
import java.security.SecureRandom
import kotlin.coroutines.cancellation.CancellationException

class AndroidTrailAccountProvider(
    private val activity: ComponentActivity,
) : TrailAccountProvider {
    private val appContext = activity.applicationContext
    private val credentialManager = CredentialManager.create(activity)
    private val preferences = appContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    override suspend fun currentAccount(): TrailUserAccount? {
        val id = preferences.getString(KEY_ID, null) ?: return null
        val email = preferences.getString(KEY_EMAIL, null).orEmpty()
        val displayName = preferences.getString(KEY_DISPLAY_NAME, null)
            ?.takeIf { it.isNotBlank() }
            ?: email.takeIf { it.isNotBlank() }
            ?: id
        return TrailUserAccount(
            id = id,
            displayName = displayName,
            email = email,
            profileImageUrl = preferences.getString(KEY_PROFILE_IMAGE_URL, null),
        )
    }

    override suspend fun signIn(): TrailAccountResult {
        val webClientId = BuildConfig.GOOGLE_AUTH_WEB_CLIENT_ID.takeIf { it.isNotBlank() }
            ?: return TrailAccountResult.Error(
                "Google sign-in needs GOOGLE_AUTH_WEB_CLIENT_ID in local.properties for this build.",
            )

        return try {
            signInWithGoogleButtonOption(webClientId)
        } catch (exception: NoCredentialException) {
            TrailAccountResult.Error("No Google account was available for sign-in.")
        } catch (exception: GetCredentialCancellationException) {
            TrailAccountResult.Cancelled
        } catch (exception: CancellationException) {
            throw exception
        } catch (exception: GetCredentialException) {
            TrailAccountResult.Error(exception.message ?: "Google sign-in could not be completed.")
        } catch (exception: GoogleIdTokenParsingException) {
            TrailAccountResult.Error("Google returned an invalid sign-in token.")
        } catch (exception: IllegalArgumentException) {
            TrailAccountResult.Error(exception.message ?: "Google sign-in returned an unsupported credential.")
        }
    }

    override suspend fun signOut() {
        runCatching {
            credentialManager.clearCredentialState(ClearCredentialStateRequest())
        }
        preferences.edit().clear().apply()
    }

    private suspend fun signInWithGoogleButtonOption(
        webClientId: String,
    ): TrailAccountResult.Success {
        val googleIdOption = GetSignInWithGoogleOption.Builder(webClientId)
            .setNonce(generateSecureRandomNonce())
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build()
        val result = credentialManager.getCredential(
            context = activity,
            request = request,
        )
        val credential = result.credential as? CustomCredential
            ?: throw IllegalArgumentException("Google sign-in returned an unsupported credential.")
        if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw IllegalArgumentException("Google sign-in returned an unsupported credential type.")
        }

        val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
        val account = googleCredential.toTrailUserAccount()
        preferences.edit()
            .putString(KEY_ID, account.id)
            .putString(KEY_DISPLAY_NAME, account.displayName)
            .putString(KEY_EMAIL, account.email)
            .putString(KEY_PROFILE_IMAGE_URL, account.profileImageUrl)
            .apply()
        return TrailAccountResult.Success(account)
    }

    private fun GoogleIdTokenCredential.toTrailUserAccount(): TrailUserAccount {
        return TrailUserAccount(
            id = id,
            displayName = displayName?.takeIf { it.isNotBlank() } ?: id,
            email = id,
            profileImageUrl = profilePictureUri?.toString(),
        )
    }

    private fun generateSecureRandomNonce(byteLength: Int = NONCE_BYTE_LENGTH): String {
        val randomBytes = ByteArray(byteLength)
        SecureRandom().nextBytes(randomBytes)
        return Base64.encodeToString(
            randomBytes,
            Base64.NO_WRAP or Base64.URL_SAFE or Base64.NO_PADDING,
        )
    }

    private companion object {
        const val PREFERENCES_NAME = "trail_mapper_account"
        const val KEY_ID = "id"
        const val KEY_DISPLAY_NAME = "display_name"
        const val KEY_EMAIL = "email"
        const val KEY_PROFILE_IMAGE_URL = "profile_image_url"
        const val NONCE_BYTE_LENGTH = 32
    }
}
