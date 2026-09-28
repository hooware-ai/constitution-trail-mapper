/**
 * Job: Provide Bloomington-Normal defaults for the shared map-point picker.
 *
 */
package com.trailmapper.shared.sijko

object MapPickerDefaultsSijko {
    fun defaultViewport(): MapViewport {
        return MapViewport(
            northLatitude = 40.53500,
            southLatitude = 40.44500,
            westLongitude = -89.06000,
            eastLongitude = -88.91500,
        )
    }

    fun defaultPoint(viewport: MapViewport = defaultViewport()): MapPoint {
        return MapPoint(
            latitude = (viewport.northLatitude + viewport.southLatitude) / 2.0,
            longitude = (viewport.westLongitude + viewport.eastLongitude) / 2.0,
        )
    }
}
