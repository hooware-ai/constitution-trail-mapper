/**
 * Job: Provide a safe fallback external-link opener for platforms without a native implementation wired.
 *
 */
package com.trailmapper.shared

object NoExternalLinkOpener : ExternalLinkOpener {
    override fun open(url: String) = Unit
}
