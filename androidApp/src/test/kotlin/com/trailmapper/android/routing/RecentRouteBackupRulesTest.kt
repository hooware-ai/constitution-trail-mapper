/**
 * Job: Verify recent routes are left out of every Android backup path while other files keep the default.
 *
 */
package com.trailmapper.android.routing

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.w3c.dom.Element

class RecentRouteBackupRulesTest {
    private val recentFile = "${AndroidRecentTrailRouteStore.PREFERENCES_NAME}.xml"

    @Test
    fun androidTwelveRulesExcludeRecentRoutesFromCloudBackupAndDeviceTransfer() {
        val rules = parse("src/main/res/xml/data_extraction_rules.xml")

        listOf("cloud-backup", "device-transfer").forEach { section ->
            val element = rules.getElementsByTagName(section).item(0) as Element
            assertEquals(listOf("sharedpref" to recentFile), excludes(element), section)
            // An include would narrow backup to listed files and change what else is kept.
            assertEquals(0, element.getElementsByTagName("include").length, section)
        }
    }

    @Test
    fun olderAndroidRulesExcludeRecentRoutesOnly() {
        val rules = parse("src/main/res/xml/backup_rules.xml")

        assertEquals(listOf("sharedpref" to recentFile), excludes(rules))
        assertEquals(0, rules.getElementsByTagName("include").length)
    }

    @Test
    fun theManifestUsesBothRuleFiles() {
        val manifest = File("src/main/AndroidManifest.xml").readText()

        assertTrue("""android:dataExtractionRules="@xml/data_extraction_rules"""" in manifest)
        assertTrue("""android:fullBackupContent="@xml/backup_rules"""" in manifest)
    }

    private fun parse(path: String): Element {
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(File(path)).documentElement
    }

    private fun excludes(element: Element): List<Pair<String, String>> {
        val nodes = element.getElementsByTagName("exclude")
        return (0 until nodes.length).map { index ->
            val exclude = nodes.item(index) as Element
            exclude.getAttribute("domain") to exclude.getAttribute("path")
        }
    }
}
