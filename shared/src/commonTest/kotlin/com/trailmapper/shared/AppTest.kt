/**
 * Job: Keep a minimal smoke test proving the shared test source set is wired.
 *
 */
package com.trailmapper.shared

import kotlin.test.Test
import kotlin.test.assertTrue

class AppTest {
    @Test
    fun sharedModuleIsReachable() {
        assertTrue(true)
    }
}
