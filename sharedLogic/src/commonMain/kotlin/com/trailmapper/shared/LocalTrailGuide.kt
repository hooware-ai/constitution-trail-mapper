/**
 * Job: Keep sourced local riding updates separate from routable trail geometry.
 */
package com.trailmapper.shared

import kotlin.time.Instant

enum class LocalTrailGuideCategory(val label: String) {
    Conditions("Conditions"), Routes("Routes"), Rules("Rules"), Maps("Maps"),
}

data class LocalTrailGuideEntry(
    val id: String,
    val category: LocalTrailGuideCategory,
    val title: String,
    val details: String,
    val status: String,
    val source: TrailResourceLink,
    val effectiveAtEpochMillis: Long? = null,
    val effectiveStatus: String? = null,
    val reviewAfterEpochMillis: Long? = null,
) {
    fun statusAt(nowEpochMillis: Long): String = when {
        reviewAfterEpochMillis != null && nowEpochMillis >= reviewAfterEpochMillis -> "Recheck needed"
        effectiveAtEpochMillis != null && nowEpochMillis >= effectiveAtEpochMillis -> effectiveStatus ?: status
        else -> status
    }
}

object LocalTrailGuide {
    const val reviewedOn = "September 7, 2026"
    const val updatedOn = "October 9, 2026"
    const val freshnessMessage = "Reviewed $reviewedOn, with selected entries updated $updatedOn. " +
        "This guide is a saved update, not live conditions. " +
        "Check official notices and signs before riding. Estimated completion dates do not confirm reopening."

    private fun epoch(iso: String) = Instant.parse(iso).toEpochMilliseconds()

    fun entries(): List<LocalTrailGuideEntry> = listOf(
        LocalTrailGuideEntry(
            "hamilton-rhodes", LocalTrailGuideCategory.Conditions, "Hamilton / Rhodes connection",
            "The city reported an all-traffic closure between 512 and 519 E. Hamilton Road from August 17. The city's " +
                "closure map (object 841, last edited September 25) now estimates completion at 6 p.m. CDT on " +
                "October 31, 2026; the older notice, last checked September 7, said September 30. Use another road " +
                "connection; a separate parallel trail is not automatically closed by this notice, and an estimate " +
                "does not confirm reopening.",
            "Closure reported · estimated through October 31",
            TrailResourceLink("City closure notice", "https://www.bloomingtonil.gov/Home/Components/News/News/10909/1394"),
            reviewAfterEpochMillis = epoch("2026-10-31T23:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "willow-trail-closure", LocalTrailGuideCategory.Conditions, "Willow Street trail crossing: Locust to Cypress",
            "Posted October 2: from 6 a.m. CDT on Monday, October 5, Constitution Trail's Illinois Central Branch is " +
                "closed between Locust Street and Cypress Avenue to rebuild the Willow Street trail crossing. The Town's " +
                "detour is Fell Avenue, via Locust Street and Cypress Street (its notice also calls the boundary Cypress " +
                "Avenue and the detour street Cypress Street). Access to private walks north of Locust is to be " +
                "maintained. Completion is estimated by 5 p.m. CDT on Monday, October 19, weather permitting; an " +
                "estimate does not confirm reopening. New routes avoid the closed section once it begins and saved " +
                "routes through it cannot start; the section, about 202 m, is projected from the Town's closure map " +
                "onto the county trail and is approximate. Trail Mapper does not route the detour.",
            "Scheduled · closure begins October 5, 6 a.m.",
            TrailResourceLink("Normal trail closure notice", "https://www.normalil.gov/m/newsflash/home/detail/3356"),
            effectiveAtEpochMillis = epoch("2026-10-05T11:00:00Z"),
            effectiveStatus = "Closed since October 5 · estimated through October 19; reopening not confirmed",
            reviewAfterEpochMillis = epoch("2026-10-19T22:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "camelback-trail-closure", LocalTrailGuideCategory.Conditions, "Virginia Avenue trail crossing (Camelback Bridge)",
            "Posted September 30: Virginia Avenue between South Linden and Hillcrest Streets closes at 8 a.m. CDT on " +
                "Monday, October 5 for bridge inspection and maintenance, and Constitution Trail is also closed at " +
                "Virginia Avenue (Camelback Bridge). Completion is estimated by 5 p.m. CDT on Tuesday, October 6, " +
                "weather permitting; an estimate does not confirm reopening. The notice gives no trail detour and no " +
                "closure limits along the trail, so Trail Mapper cannot plan around it: once the closure begins, a route " +
                "that crosses there can be previewed but not started. The road closure does not define the trail closure, and Trail Mapper " +
                "marks no additional neighboring trail interval from this notice; that is a statement about what this " +
                "app draws, not that any other road or trail is open. Follow posted signs.",
            "Scheduled · closure begins October 5, 8 a.m.",
            TrailResourceLink("Normal bridge closure notice", "https://www.normalil.gov/m/newsflash/Home/Detail/3353"),
            effectiveAtEpochMillis = epoch("2026-10-05T13:00:00Z"),
            effectiveStatus = "Closed at Virginia Avenue since October 5 · estimated through October 6; reopening not confirmed",
            reviewAfterEpochMillis = epoch("2026-10-06T22:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "virginia-water-main-road-2026-10-07", LocalTrailGuideCategory.Conditions,
            "Virginia Avenue road access: Linden to Broadway",
            "Posted October 5: Virginia Avenue between Linden Street and Broadway closes for water main installation " +
                "from 7 a.m. CDT on Wednesday, October 7. Virginia Avenue access is maintained for local traffic only; " +
                "Linden Street has one lane open in each direction. Completion is estimated by 5 p.m. CDT on Friday, " +
                "October 23, weather permitting; that estimate does not confirm reopening. This is a road restriction, " +
                "separate from the Camelback Bridge trail-crossing notice. It does not establish that the trail is " +
                "closed or reopened, and Trail Mapper does not mark a trail barrier from it. Check posted signs and " +
                "the Town's current notice before using the road connection.",
            "Scheduled road restriction · begins October 7, 7 a.m.",
            TrailResourceLink("Normal Virginia Avenue road notice", "https://www.normalil.gov/m/newsflash/Home/Detail/3360"),
            effectiveAtEpochMillis = epoch("2026-10-07T12:00:00Z"),
            effectiveStatus = "Road restricted since October 7 · local traffic only; October 23 end estimated",
            reviewAfterEpochMillis = epoch("2026-10-23T22:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "hershey-work", LocalTrailGuideCategory.Conditions, "Hershey: Lamon Drive to GE Road",
            "Road, curb, drainage and sidewalk work is scheduled to begin September 8, 2026. " +
                "The street stays open, with travel impacts. The notice does not give a confirmed finish date.",
            "Scheduled · September 8, 2026",
            TrailResourceLink("City roadwork notice", "https://www.bloomingtonil.gov/Home/Components/News/News/10939/1394?backlist=%2Fdepartments%2Fengineering%2Fbloomington-streets"),
            effectiveAtEpochMillis = epoch("2026-09-08T05:00:00Z"), effectiveStatus = "Scheduled start reached · check current notice",
            reviewAfterEpochMillis = epoch("2026-10-01T05:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "storm-cleanup", LocalTrailGuideCategory.Conditions, "Storm cleanup on Constitution Trail",
            "Normal's August 18 update describes intermittent closures while crews remove trees and limbs damaged " +
                "in the August 13 storm. As of September 27, no later storm-cleanup trail update or all-clear was found " +
                "from Normal or Bloomington. Follow local closure signs; the earlier blanket closure is not a " +
                "reliable description of every segment today.",
            "Segment access unverified · no all-clear found September 27",
            TrailResourceLink("Normal storm update", "https://www.normalil.gov/m/newsflash/Archive/Item/3319?arcId=6477"),
            reviewAfterEpochMillis = epoch("2026-10-27T05:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "uptown-detour", LocalTrailGuideCategory.Conditions, "Uptown Normal: Underpass construction detour",
            "Beginning September 21, 2026, the Town announced a closure north of Vernon Avenue while a detour " +
                "sidewalk is built. Once the trail reopens, the signed detour leaves the trail at " +
                "Phoenix Avenue: west on Phoenix to Broadway, north on Broadway to the north sidewalk of Beaufort Street, " +
                "and east on Beaufort to Uptown Circle, rejoining at the trailhead north of Uptown Circle. On Uptown " +
                "sidewalks, dismount and walk your bike; in the street, follow traffic up Beaufort and around Uptown Circle. " +
                "The detour lasts until construction is complete. Trail Mapper routes do not yet follow this detour; " +
                "new routes avoid the closed section, and saved routes through it show a detour advisory.",
            "Closure, then signed detour · from September 21, 2026",
            TrailResourceLink("Normal trail detour notice", "https://www.normalil.gov/m/newsflash/Home/Detail/3337"),
            reviewAfterEpochMillis = epoch("2026-10-27T05:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "collegiate-repaving", LocalTrailGuideCategory.Conditions, "Collegiate Branch repaving: Fairview Park to Heartland",
            "Repaving from the south entrance of Fairview Park at Adelaide Street to Heartland Community College at " +
                "Millennium Boulevard was expected to begin September 28 or 29, weather permitting. Repairs, patching and " +
                "milling need targeted, temporary closures in individual sections before the overlay. The September 24 " +
                "notice estimated the closures would end by October 2. No confirmed completion was found, and the " +
                "October 2 trail paving notice below is the latest evidence checked. Follow posted closure and detour signs.",
            "Scheduled · from September 28, 2026",
            TrailResourceLink("Normal repaving notice", "https://www.normalil.gov/m/newsflash/Home/Detail/3345"),
            effectiveAtEpochMillis = epoch("2026-09-28T05:00:00Z"),
            effectiveStatus = "Work expected · targeted closures through October 2 estimate",
            reviewAfterEpochMillis = epoch("2026-10-03T05:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "trail-paving-raab", LocalTrailGuideCategory.Conditions, "Constitution Trail paving: Raab Road",
            "Posted October 2: paving work on Constitution Trail begins Saturday, October 3 and needs temporary trail " +
                "and lane closures on Raab Road. The eastbound lane near the ISU Horticulture Center and Cornbelters " +
                "Stadium closes from 6 a.m. October 3; the westbound lane from near Cornbelters Stadium to Millennium " +
                "Boulevard closes 6 a.m.–4 p.m. on Monday, October 5 and Tuesday, October 6. Those are road-lane " +
                "closures. The notice does not say which trail sections close, when each reopens or when the work ends, so " +
                "Trail Mapper does not mark a trail barrier; follow posted signs.",
            "Scheduled · paving begins October 3, 2026",
            TrailResourceLink("Normal paving notice", "https://www.normalil.gov/m/newsflash/Home/Detail/3357"),
            effectiveAtEpochMillis = epoch("2026-10-03T11:00:00Z"),
            effectiveStatus = "Paving under way · temporary closures; trail sections and end not published",
            reviewAfterEpochMillis = epoch("2026-10-07T05:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "west-college", LocalTrailGuideCategory.Conditions, "West College toward Rivian Motorway",
            "Construction between White Oak Road and Rivian Motorway continues through fall 2026. " +
                "The September traffic-stage announcement does not confirm a continuous open bike path.",
            "Bike-path opening unverified",
            TrailResourceLink("Normal construction notice", "https://www.normalil.gov/m/newsflash/Home/Detail/3330"),
            reviewAfterEpochMillis = epoch("2026-12-01T06:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "route66-greenwood", LocalTrailGuideCategory.Routes, "Route 66: Morris / Veterans to Greenwood",
            "Bloomington marks the new 10-foot multiuse path complete. The project also added the " +
                "Danbury–Fox Lake sidewalk near Pepper Ridge School. Trail Mapper includes the verified Morris–Greenwood " +
                "path geometry. Completion is a project status, not a live conditions report.",
            "City project marked complete · August 2026 record",
            TrailResourceLink("City infrastructure map", "https://cityblm.maps.arcgis.com/apps/dashboards/2f7164aa23ec445bb9e235e9c51ec234"),
        ),
        LocalTrailGuideEntry(
            "trail-improvements", LocalTrailGuideCategory.Routes, "Hamilton, Robinson and Benjamin School improvements",
            "The city records April 24, 2026 construction completion for Hamilton resurfacing from Bunn to " +
                "State Farm Park, the trail east of Robinson from Locust to Chestnut, and Stone Roller Circle–Benjamin School trail work. " +
                "A short Stone Roller connector still lacks sufficiently verified map geometry in Trail Mapper.",
            "City project marked complete · April 2026",
            TrailResourceLink("City infrastructure map", "https://cityblm.maps.arcgis.com/apps/dashboards/2f7164aa23ec445bb9e235e9c51ec234"),
        ),
        LocalTrailGuideEntry(
            "heartland", LocalTrailGuideCategory.Routes, "Heartland's COUNTRY Financial Trail",
            "The roughly one-mile path around Birky Pond opened October 24, 2025, connected to Constitution Trail. " +
                "Trail Mapper includes the pond circuit and mapped existing bridge, but does not yet have mapped geometry " +
                "for its connection to the Raab Road trail. Later bridge, pavilion and prairie work was planned for spring 2026; " +
                "completion of those additions was not confirmed.",
            "Trail opened · October 2025",
            TrailResourceLink("Heartland opening announcement", "https://www.heartland.edu/news/2025/10.2025CFTrailRibbonCutting102425.html"),
        ),
        LocalTrailGuideEntry(
            "gregory", LocalTrailGuideCategory.Routes, "Gregory Street: Adelaide to Parkside",
            "The extension toward Maxwell Park and the ISU campus was substantially completed in November 2024. " +
                "It is existing infrastructure, separate from the future west-Normal connection.",
            "Existing trail",
            TrailResourceLink("Normal completion report", "https://www.normalil.gov/Archive/ViewFile/Item/5210"),
        ),
        LocalTrailGuideEntry(
            "maxwell", LocalTrailGuideCategory.Routes, "Maxwell Park connection toward West College",
            "$1.9 million in federal funding supports a connection from Gregory / Parkside through Maxwell Park " +
                "toward West College and Rivian Motorway. Construction could begin as soon as 2028. Funding does not mean the route is open.",
            "Funded · future route",
            TrailResourceLink("Normal funding announcement", "https://www.normalil.gov/m/newsflash/Home/Detail/3205"),
        ),
        LocalTrailGuideEntry(
            "veterans", LocalTrailGuideCategory.Routes, "Veterans Parkway bike paths",
            "The September 2026 preferred plan includes walking and biking paths on both sides. The regional " +
                "planning commission's adoption vote was scheduled for September 23; as of September 27 its outcome had " +
                "not been published. Adoption would only send the recommendations to IDOT, which has the final say. " +
                "Further funding, design and construction would still be needed.",
            "Proposed · not an open route",
            TrailResourceLink("Regional planning project", "https://mcplan.org/plans-and-programs/transportation-planning/veteranspkwy"),
            reviewAfterEpochMillis = epoch("2026-10-27T05:00:00Z"),
        ),
        LocalTrailGuideEntry(
            "uptown", LocalTrailGuideCategory.Routes, "Uptown Connector / Underpass",
            "The construction contract was awarded in May 2026 for a trail crossing under the railroad. " +
                "Construction began in September 2026: the Town closed the Parkinson Street lot and detoured the trail " +
                "from September 21. The announced target is June 2028.",
            "Under construction · not open",
            TrailResourceLink("Town construction notice", "https://www.normalil.gov/m/newsflash/Home/Detail/3337"),
        ),
        LocalTrailGuideEntry(
            "lafayette", LocalTrailGuideCategory.Routes, "Lafayette Street–Hamilton Road extension",
            "The city's August 2026 record lists design work, with no actual construction dates. " +
                "Its schedule fields conflict, so there is no confirmed opening date.",
            "In design · not open",
            TrailResourceLink("City infrastructure map", "https://cityblm.maps.arcgis.com/apps/dashboards/2f7164aa23ec445bb9e235e9c51ec234"),
        ),
        LocalTrailGuideEntry(
            "chenoa", LocalTrailGuideCategory.Routes, "Chenoa Route 66 rail crossing",
            "A crossing agreement was approved in May 2026, with hopes for a fall finish. Opening was not confirmed. " +
                "Do not assume a continuous off-road trail through Towanda, Lexington and Chenoa.",
            "Approved project · opening unverified",
            TrailResourceLink("Crossing project report", "https://www.wglt.org/local-news/2026-05-11/chenoa-rail-crossing-is-latest-link-for-route-66-and-constitution-trails"),
        ),
        LocalTrailGuideEntry(
            "linden", LocalTrailGuideCategory.Routes, "Linden Street trail bridge replacement",
            "Bids for replacing the Constitution Trail bridge were due September 2, 2026. " +
                "The solicitation does not establish a current closure or construction start.",
            "Replacement planned · access not confirmed by bid notice",
            TrailResourceLink("Normal bridge project", "https://www.normalil.gov/bids.aspx?bidID=541"),
        ),
        LocalTrailGuideEntry(
            "downtown", LocalTrailGuideCategory.Routes, "Downtown North Main plan changed",
            "In April 2026, Bloomington replaced planned bike-capable flex lanes in the 300–500 blocks with " +
                "parking and loading zones. East and Madison bike accommodations are separate proposals; an existing bike lane was not removed.",
            "Proposed bike accommodation removed from plan",
            TrailResourceLink("Council decision report", "https://www.wglt.org/local-news/2026-04-28/bloomington-sets-date-for-data-center-discussion-council-disagrees-over-streetscape-change"),
        ),
        LocalTrailGuideEntry(
            "normal-rules", LocalTrailGuideCategory.Rules, "Normal: trail access and e-bikes",
            "Normal explicitly permits e-bikes on Constitution Trail and streets, but not sidewalks. " +
                "Its table does not distinguish classes. Ride at a safe speed, keep right and give an audible warning before passing. " +
                "Bicycles are prohibited on Uptown sidewalks. No numeric trail speed limit is published on this page.",
            "Normal rules · checked September 2026",
            TrailResourceLink("Normal trail rules", "https://www.normalil.gov/1467/Rules-of-the-Trail"),
        ),
        LocalTrailGuideEntry(
            "bloomington-rules", LocalTrailGuideCategory.Rules, "Bloomington: trail speed and access",
            "The park code limits vehicles, including bicycles, to 15 mph, subject to its posted-road exception; " +
                "a slower reasonable speed may be required. This is Bloomington's rule, not a verified shared limit for Normal. " +
                "The old motorized-vehicle wording does not explicitly classify modern low-speed e-bikes; " +
                "do not treat it as a confirmed ban on every e-bike.",
            "Bloomington park rules",
            TrailResourceLink("Bloomington park traffic code", "https://ecode360.com/34411375"),
        ),
        LocalTrailGuideEntry(
            "hours", LocalTrailGuideCategory.Rules, "Trail hours and courtesy",
            "Constitution Trail hours are one hour before sunrise through one hour after sunset. " +
                "Obey signs, keep right, yield appropriately and announce passing. Local conditions may require walking your bike.",
            "Published trail hours",
            TrailResourceLink("Official trail guidance", "https://www.normalil.gov/1467/Rules-of-the-Trail"),
        ),
        LocalTrailGuideEntry(
            "illinois-2027", LocalTrailGuideCategory.Rules, "Illinois e-bike law: January 1, 2027",
            "Signed August 26, 2026. From January 1, 2027, the minimum operator age for Class 1/2 is 15; " +
                "Class 3 remains 16. Under-18 operators have passenger restrictions. Electric cycles that do not qualify " +
                "as low-speed e-bikes are subject to different rules, including bicycle/shared-use path restrictions. " +
                "Check the law for your device and route.",
            "Upcoming · effective January 1, 2027",
            TrailResourceLink("Enacted Illinois law", "https://ilga.gov/ftp/Public%20Acts/104/104-0854.htm"),
            effectiveAtEpochMillis = epoch("2027-01-01T06:00:00Z"), effectiveStatus = "Effective January 1, 2027 · check current law",
        ),
        LocalTrailGuideEntry(
            "county-map", LocalTrailGuideCategory.Maps, "Latest county trail map",
            "Friends of Constitution Trail identifies the McLean County GIS map as its most up-to-date map. " +
                "Trail Mapper's county source was checked September 7, 2026: all 260 mapped features matched. " +
                "That checks source freshness, not temporary closures or every new opening.",
            "Primary public trail map",
            TrailResourceLink("Open county trail map", "https://mcleangis.maps.arcgis.com/apps/instant/sidebar/index.html?appid=d98c151296fd4b03860af8f4df7787a4"),
        ),
        LocalTrailGuideEntry(
            "app-map", LocalTrailGuideCategory.Maps, "Trail Mapper's supplemented map",
            "The in-app map combines 260 county features with four verified OpenStreetMap paths at Morris–Greenwood " +
                "and Birky Pond. The additions also support route generation. Proposed paths stay off by default. " +
                "The Birky Pond–Raab connection and a short Stone Roller connector remain mapping gaps; " +
                "the app does not draw invented connections across them.",
            "County map plus verified additions · September 2026",
            TrailResourceLink("OpenStreetMap sources and license", "https://www.openstreetmap.org/copyright"),
        ),
        LocalTrailGuideEntry(
            "heartland-map", LocalTrailGuideCategory.Maps, "Heartland campus map — August 2026",
            "Heartland's updated campus map shows the COUNTRY Financial Trail around Birky Pond and its campus " +
                "connections. It is a useful newer local map, while the regional printable brochure remains older.",
            "Updated campus map · 2026.08 edition",
            TrailResourceLink("Open Heartland campus map", "https://www.heartland.edu/documents/about/hccCampusMap.pdf"),
        ),
        LocalTrailGuideEntry(
            "paper-map", LocalTrailGuideCategory.Maps, "Printable trail map — June 2022",
            "The downloadable brochure is labeled June 2022. It is useful for a paper overview, " +
                "but use the county GIS map and current notices for newer route information.",
            "Older print edition",
            TrailResourceLink("Open June 2022 PDF", "https://www.constitutiontrail.org/_files/ugd/05629c_44a060ef89384409a6858e66a02a2cac.pdf"),
        ),
        LocalTrailGuideEntry(
            "construction-map", LocalTrailGuideCategory.Maps, "Current construction and closures",
            "The county construction map brings together Bloomington, Normal, county and IDOT roadwork. " +
                "Check current notices for route access. A project-completion label is separate from a current closure report.",
            "Official road-closure sources",
            TrailResourceLink("Open closures and interactive map", "https://www.mcleancountyil.gov/319/Road-Closures-Construction-Map"),
        ),
    )
}
