/**
 * Job: Provide official Constitution Trail resource links for the app menu.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.TrailResourceLink

object TrailResourceLinksSijko {
    fun links(): List<TrailResourceLink> {
        return listOf(
            TrailResourceLink(
                title = "Latest county trail map",
                url = "https://mcleangis.maps.arcgis.com/apps/instant/sidebar/index.html?appid=d98c151296fd4b03860af8f4df7787a4",
                description = "McLean County's interactive GIS map, recommended by Friends of the Trail as its most updated map. Check closures separately.",
                showOnHome = true,
            ),
            TrailResourceLink(
                title = "County road closures and construction",
                url = "https://www.mcleancountyil.gov/319/Road-Closures-Construction-Map",
                description = "Official notices and an interactive map of current and planned roadwork. Road notices do not cover every trail obstruction.",
                showOnHome = true,
            ),
            TrailResourceLink(
                title = "Bloomington roadwork updates",
                url = "https://www.bloomingtonil.gov/departments/engineering/bloomington-streets",
                description = "City street and sidewalk work, closure notices, and project updates.",
            ),
            TrailResourceLink(
                title = "Normal road closure notices",
                url = "https://www.normalil.gov/m/newsflash?cat=5",
                description = "Town roadwork notices. Check each notice's dates and affected area.",
            ),
            TrailResourceLink(
                title = "Bloomington project map",
                url = "https://cityblm.maps.arcgis.com/apps/dashboards/2f7164aa23ec445bb9e235e9c51ec234",
                description = "Planned, active, and completed infrastructure projects. Project completion is separate from today's trail access.",
            ),
            TrailResourceLink(
                title = "Normal trail rules",
                url = "https://www.normalil.gov/1467/Rules-of-the-Trail",
                description = "Normal's trail hours, safe riding rules, and permitted devices, including e-bikes. These are Normal's local rules.",
            ),
            TrailResourceLink(
                title = "Bloomington park and trail traffic rules",
                url = "https://ecode360.com/34411375",
                description = "Bloomington's park traffic ordinance. Local rules can differ from Normal's.",
            ),
            TrailResourceLink(
                title = "Illinois e-bike law: effective Jan. 1, 2027",
                url = "https://ilga.gov/ftp/Public%20Acts/104/104-0854.htm",
                description = "Public Act 104-0854 changes micromobility rules effective January 1, 2027. The new requirements do not take effect early.",
            ),
            TrailResourceLink(
                title = "Trail map downloads",
                url = "https://www.constitutiontrail.org/trail-maps",
                description = "Friends of the Trail's map index. Its paper PDF is dated June 2022; use the county GIS map for newer mapping.",
            ),
            TrailResourceLink(
                title = "Friends of the Constitution Trail",
                url = "https://www.constitutiontrail.org/",
                description = "Local trail advocacy, amenities, and community information.",
            ),
            TrailResourceLink(
                title = "Bloomington trail page",
                url = "https://www.bloomingtonparks.org/parks/constitution-trail",
                description = "Bloomington Parks information, trail etiquette, and snow removal policy.",
            ),
            TrailResourceLink(
                title = "Normal trail page",
                url = "https://www.normalil.gov/1121/Constitution-Trail",
                description = "Normal Parks trail information and trailhead details.",
            ),
        )
    }
}
