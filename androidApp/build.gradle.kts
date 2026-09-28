import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

val localProperties = Properties().apply {
    val localPropertiesFile = rootProject.file("local.properties")
    if (localPropertiesFile.isFile) {
        localPropertiesFile.inputStream().use(::load)
    }
}
val mapsApiKey = localProperties.getProperty("MAPS_API_KEY")
    ?: System.getenv("MAPS_API_KEY")
    ?: ""
val googleAuthWebClientId = localProperties.getProperty("GOOGLE_AUTH_WEB_CLIENT_ID")
    ?: System.getenv("GOOGLE_AUTH_WEB_CLIENT_ID")
    ?: ""

plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeCompiler)
}

android {
    namespace = "com.trailmapper.android"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "com.trailmapper"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        versionCode = 2
        versionName = "0.2.0"
        manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
        buildConfigField("String", "GOOGLE_AUTH_WEB_CLIENT_ID", googleAuthWebClientId.quotedForBuildConfig())
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        getByName("main") {
            assets.directories.add(rootProject.file("data/generated").path)
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
    }
}

dependencies {
    implementation(projects.shared)
    implementation(libs.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.foundation)
    implementation(libs.androidx.compose.material.icons.extended)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.ui)
    implementation(libs.credentials)
    implementation(libs.credentials.play.services.auth)
    implementation(libs.coroutines.play.services)
    implementation(libs.fragment)
    implementation(libs.googleid)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.maplibre.android)
    implementation(libs.maps.compose)
    implementation(libs.places)
    implementation(libs.play.services.location)
    testImplementation(kotlin("test-junit"))
    testImplementation(libs.coroutines.test)
}

val verifyTrailRoutingAssets by tasks.registering {
    // Generated routing assets the app loads at runtime, each with the command that produces it.
    val generatorsByAsset = mapOf(
        "mcgis-trails.normalized.json" to ".\\tools\\fetch-mcgis-trails.ps1",
        "verified-trail-additions.normalized.json" to "python tools/fetch-verified-trail-additions.py",
        "mclean-access-roads.normalized.json" to ".\\tools\\fetch-tigerweb-access-roads.ps1",
    )
    val assets = generatorsByAsset.keys.associateWith { rootProject.file("data/generated/$it") }
    inputs.files(assets.values)
    doLast {
        val missing = assets.filterValues { !it.isFile }.keys
        check(missing.isEmpty()) {
            "Missing routing assets in data/generated. From the repository root, run:\n" +
                missing.joinToString("\n") { "  ${generatorsByAsset.getValue(it)}  (creates $it)" }
        }
    }
}

tasks.named("preBuild") {
    dependsOn(verifyTrailRoutingAssets)
}

fun String.quotedForBuildConfig(): String {
    return "\"${replace("\\", "\\\\").replace("\"", "\\\"")}\""
}
