/**
 * Job: Define the official source links and concise roles shown on Trail Mapper's About screen.
 *
 */
package com.trailmapper.shared.sijko

import com.trailmapper.shared.TrailMapperAboutSourceLink

object TrailMapperAboutSourceLinksSijko {
    fun links(): List<TrailMapperAboutSourceLink> {
        return listOf(
            TrailMapperAboutSourceLink(
                title = "McLean County GIS map",
                role = "Published county trail map and source of Trail Mapper's bundled trail geometry. Opening this map shows the county's current publication; it does not automatically refresh the app's routing data or confirm temporary closures.",
                url = "https://mcleangis.maps.arcgis.com/apps/instant/sidebar/index.html?appid=d98c151296fd4b03860af8f4df7787a4",
            ),
            TrailMapperAboutSourceLink(
                title = "Census TIGERweb",
                role = "Source of bundled ordinary-road geometry used for access routing to and from mapped trail segments. It does not provide live road closures.",
                url = "https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_apps.html",
            ),
            TrailMapperAboutSourceLink(
                title = "OpenStreetMap copyright and ODbL",
                role = "Attribution and license information for OpenStreetMap data used in verified local trail additions, endpoint access routing, and shared route images.",
                url = "https://www.openstreetmap.org/copyright",
            ),
            TrailMapperAboutSourceLink(
                title = "Google Maps Platform",
                role = "Interactive Android maps and Google Places address search.",
                url = "https://mapsplatform.google.com/",
            ),
            TrailMapperAboutSourceLink(
                title = "MapLibre Native",
                role = "Open-source renderer used to compose saved route images.",
                url = "https://maplibre.org/projects/native/",
            ),
            TrailMapperAboutSourceLink(
                title = "OpenFreeMap",
                role = "Basemap tiles used by the saved route image renderer.",
                url = "https://openfreemap.org/",
            ),
            TrailMapperAboutSourceLink(
                title = "OpenMapTiles",
                role = "Vector tile schema and map data used with the saved route image renderer.",
                url = "https://openmaptiles.org/",
            ),
        )
    }
}
