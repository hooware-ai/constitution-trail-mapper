/**
 * Job: Define the shared platform boundary for opening trail-resource links outside the app.
 *
 */
package com.trailmapper.shared

interface ExternalLinkOpener {
    fun open(url: String)
}
