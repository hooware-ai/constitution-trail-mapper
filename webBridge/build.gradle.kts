plugins {
    alias(libs.plugins.kotlinMultiplatform)
    alias(libs.plugins.kotlinSerialization)
}

kotlin {
    jvm()
    js {
        browser()
        nodejs()
        useEsModules()
        binaries.library()
        compilerOptions { moduleName.set("trailmapper-web-bridge") }
    }
    sourceSets {
        commonMain.dependencies {
            implementation(projects.sharedLogic)
            implementation(libs.kotlinx.serialization.json)
        }
        commonTest.dependencies { implementation(kotlin("test")) }
    }
}
