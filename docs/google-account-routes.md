# Google Account Routes

Trail Mapper supports optional Google sign-in on Android through Android Credential Manager.

## Android Setup

- Register an Android app for package `com.trailmapper` in your own Firebase project.
- Register your debug signing certificate SHA-1 with that Firebase Android app.
- Enable Google Sign-In in Firebase Authentication using your own support email.
- Keep `firebase.json`, `.firebaserc`, and the generated `androidApp/google-services.json` local; all are ignored by Git.

## Firebase Auth CLI Setup

The global Firebase CLI on this machine may be older than the Auth provider CLI docs. Use a current CLI through `npx` when configuring Auth:

```powershell
npx -y firebase-tools@15.23.0 init auth --project YOUR_FIREBASE_PROJECT_ID
npx -y firebase-tools@15.23.0 deploy --only auth --project YOUR_FIREBASE_PROJECT_ID
```

After deploy, re-read the Android SDK config and use the `oauth_client` entry with `client_type: 3` as the Android Credential Manager web client ID.

## Required Local Build Value

Credential Manager needs the Google Auth Platform Web client ID. Put it in ignored `local.properties`:

```properties
GOOGLE_AUTH_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
```

Without that value, the Android app still builds and saved routes still work locally, but tapping `Sign in` shows a setup error.

## Product Behavior

- Saved routes remain local and offline-capable.
- Google sign-in is optional and stores the signed-in profile locally for the app shell.
- Saved routes can be shared through the Android system share sheet.
- True cross-device cloud sync should be added behind `SavedTrailRouteStore` after Firebase Authentication and Firestore security rules are finalized.
