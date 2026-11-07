package com.trailmapper.android

import androidx.compose.ui.graphics.toArgb
import com.trailmapper.shared.trailMapperColorScheme
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.w3c.dom.Element

class ThemeResourceContrastTest {
    @Test
    fun routeMapStartingWindowMatchesModernDarkStatusProtection() {
        val root = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/res/values-v35/styles.xml")).documentElement
        val styles = root.getElementsByTagName("style")
        val style = (0 until styles.length).map { styles.item(it) as Element }
            .single { it.getAttribute("name") == "TrailMapperRouteMapLaunchTheme" }
        assertEquals("TrailMapperRouteMapLaunchTheme", style.getAttribute("name"))
        assertEquals("AppTheme", style.getAttribute("parent"))
        val nodes = style.getElementsByTagName("item")
        val items = (0 until nodes.length).associate { i ->
            val item = nodes.item(i) as Element
            item.getAttribute("name") to item.textContent.trim()
        }
        val dark = trailMapperColorScheme(true).background.toArgb()
        for (key in listOf("android:windowSplashScreenBackground", "android:windowBackground",
            "android:statusBarColor", "android:navigationBarColor")) {
            assertTrue(items.getValue(key).matches(Regex("#[0-9A-Fa-f]{6}")))
            assertEquals(dark, items.getValue(key).removePrefix("#").toLong(16).toInt() or 0xFF000000.toInt())
        }
        assertEquals("false", items["android:windowLightStatusBar"])
        assertEquals("false", items["android:windowLightNavigationBar"])
        val manifest = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/AndroidManifest.xml"))
        val activities = manifest.getElementsByTagName("activity")
        val routeMap = (0 until activities.length).map { activities.item(it) as Element }
            .single { it.getAttribute("android:name") == ".map.TrailRouteMapActivity" }
        assertEquals("@style/TrailMapperRouteMapLaunchTheme", routeMap.getAttribute("android:theme"))
    }

    @Test
    fun startupResourcesAgreeWithComposeAndUseReadableSystemIconsInBothModes() {
        for (folder in listOf("values", "values-v27", "values-night")) {
            val dark = folder == "values-night"
            val root = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(File("src/main/res/$folder/styles.xml")).documentElement
            val styles = root.getElementsByTagName("style")
            val appTheme = (0 until styles.length).map { styles.item(it) as Element }
                .single { it.getAttribute("name") == "AppTheme" }
            val nodes = appTheme.getElementsByTagName("item")
            val items = (0 until nodes.length).associate { i ->
                val item = nodes.item(i) as Element
                item.getAttribute("name") to item.textContent.trim()
            }
            assertEquals(if (folder == "values") null else (!dark).toString(), items["android:windowLightNavigationBar"])
            assertEquals((!dark).toString(), items["android:windowLightStatusBar"])
            val background = trailMapperColorScheme(dark).background.toArgb()
            for (key in listOf("android:navigationBarColor", "android:statusBarColor", "android:windowBackground")) {
                val hex = items.getValue(key).removePrefix("#")
                assertTrue(hex.length == 6)
                val expected = if (folder == "values" && key == "android:navigationBarColor") trailMapperColorScheme(true).background.toArgb() else background
                assertEquals(expected, hex.toLong(16).toInt() or 0xFF000000.toInt(), key)
            }
        }
    }
}
