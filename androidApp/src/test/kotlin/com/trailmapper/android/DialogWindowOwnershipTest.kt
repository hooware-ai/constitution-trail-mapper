package com.trailmapper.android

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DialogWindowOwnershipTest {
    private data class Node(val parent: Node? = null, val window: String? = null, val activityContextWindow: String? = null)
    @Test fun nearestDialogOwnsAppearanceInsteadOfTheActivityOrOuterDialog() {
        val activity = Node(window = "activity")
        val outer = Node(activity, "outer")
        val dialog = Node(outer, "directions")
        val compose = Node(Node(dialog))
        assertEquals("directions", findWindowOwnerInParents(compose, { it.parent }, { it.window }))
    }
    @Test fun noProviderDoesNotInventAnActivityFallback() {
        val activityContext = Node(activityContextWindow = "main-activity")
        assertNull(findWindowOwnerInParents(Node(Node(activityContext)), { it.parent }, { it.window }))
    }
    @Test fun fullHeightSheetProtectionStillCoversOnlyItsOwnStatusInset() {
        assertEquals(listOf(NavigationProtectionRect(0f,0f,2400f,95f)),
            navigationProtectionRects(2400f,1080f,SystemBarInsets(0,95,0,0)))
        assertEquals(emptyList(), navigationProtectionRects(800f,400f,SystemBarInsets(0,0,0,0)))
    }
    @Test fun runtimeThemeOverlayChangesOnlyStatusAndCannotOverridePassedNavigationOrPalette() {
        val root = javax.xml.parsers.DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(java.io.File("src/main/res/values/styles.xml")).documentElement
        val styles = root.getElementsByTagName("style")
        val overlay = (0 until styles.length).map { styles.item(it) as org.w3c.dom.Element }
            .single { it.getAttribute("name") == "TrailMapperModernStatusWindow" }
        val items = overlay.getElementsByTagName("item")
        assertEquals("", overlay.getAttribute("parent"))
        assertEquals(1, items.length)
        val item = items.item(0) as org.w3c.dom.Element
        assertEquals("android:windowLightStatusBar", item.getAttribute("name"))
        assertEquals("false", item.textContent.trim())
    }
    @Test fun dialogAndActivityStatusContractsAgreeOnModernDarkBackdropInBothThemes() {
        assertNull(dialogLightStatusOverride(26))
        assertNull(dialogLightStatusOverride(34))
        for (api in listOf(35,36)) for (dark in listOf(false,true)) {
            assertEquals(usesDarkStatusIcons(api,dark), dialogLightStatusOverride(api))
        }
    }
}
