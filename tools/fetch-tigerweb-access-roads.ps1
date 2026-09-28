<#
Job: Fetch TIGERweb streets plus OpenStreetMap service roads for Trail Mapper endpoint access routing.

#>

[CmdletBinding()]
param(
    [string] $OutputPath = "data/generated/mclean-access-roads.normalized.json",
    [double[]] $BoundingBox = @(-89.20, 40.40, -88.90, 40.60),
    [int] $PageSize = 2000,
    [string] $OverpassUrl = "https://overpass-api.de/api/interpreter"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "Write-GeneratedAsset.ps1")

$fullOutputPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
    [System.IO.Path]::GetFullPath($OutputPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $OutputPath))
}
$outputDirectory = Split-Path -Parent $fullOutputPath
if (-not (Test-Path $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}

$includedMtfcc = @(
    "S1400",
    "S1640",
    "S1710",
    "S1730",
    "S1780",
    "S1820"
)

$sources = @{
    tigerwebTransportationService = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer"
    tigerLineAllRoads = "https://catalog.data.gov/dataset/tiger-line-shapefile-current-county-mclean-county-il-all-roads"
    openStreetMap = "https://www.openstreetmap.org/copyright"
    openStreetMapOverpass = $OverpassUrl
    boundingBoxWgs84 = @($BoundingBox)
    includedMtfcc = @($includedMtfcc)
    includedOsmHighways = @("service")
}

$layers = @(
    @{
        id = 8
        name = "Local Roads"
        url = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8"
    }
)

function Convert-Feature {
    param(
        [int] $LayerId,
        [string] $LayerName,
        [object] $Feature
    )

    $attributes = $Feature.attributes

    return [ordered]@{
        id = "$($LayerId):$($attributes.OBJECTID)"
        sourceLayerId = $LayerId
        sourceLayerName = $LayerName
        objectId = $attributes.OBJECTID
        oid = $attributes.OID
        name = if ([string]::IsNullOrWhiteSpace($attributes.NAME)) { $null } else { $attributes.NAME.Trim() }
        baseName = if ([string]::IsNullOrWhiteSpace($attributes.BASENAME)) { $null } else { $attributes.BASENAME.Trim() }
        mtfcc = $attributes.MTFCC
        routeType = $attributes.RTTYP
        paths = $Feature.geometry.paths
    }
}

function Get-LayerFeatures {
    param(
        [object] $Layer
    )

    $allFeatures = [System.Collections.Generic.List[object]]::new()
    $offset = 0
    $bbox = $BoundingBox -join ","
    $whereClause = "MTFCC IN ('$($includedMtfcc -join "','")')"
    $encodedWhere = [uri]::EscapeDataString($whereClause)

    do {
        $query = "$($Layer.url)/query?where=$encodedWhere&geometry=$bbox&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,OID,NAME,BASENAME,MTFCC,RTTYP&returnGeometry=true&outSR=4326&f=json&orderByFields=OBJECTID&resultOffset=$offset&resultRecordCount=$PageSize"
        $response = Invoke-RestMethod -Uri $query
        $pageFeatures = @($response.features)

        foreach ($feature in $pageFeatures) {
            if ($null -ne $feature.geometry -and $null -ne $feature.geometry.paths) {
                $allFeatures.Add((Convert-Feature $Layer.id $Layer.name $feature)) | Out-Null
            }
        }

        $offset += $pageFeatures.Count
    } while ($pageFeatures.Count -gt 0 -and $response.exceededTransferLimit)

    return @($allFeatures)
}

function Get-OsmServiceFeatures {
    $south = $BoundingBox[1].ToString([Globalization.CultureInfo]::InvariantCulture)
    $west = $BoundingBox[0].ToString([Globalization.CultureInfo]::InvariantCulture)
    $north = $BoundingBox[3].ToString([Globalization.CultureInfo]::InvariantCulture)
    $east = $BoundingBox[2].ToString([Globalization.CultureInfo]::InvariantCulture)
    $query = "[out:json][timeout:120];way[`"highway`"=`"service`"]($south,$west,$north,$east);out tags geom;"
    $encodedQuery = [uri]::EscapeDataString($query)
    $headers = @{
        Accept = "application/json"
        "User-Agent" = "TrailMapperDevelopment/1.0 (local routing-data prototype)"
    }
    $response = Invoke-RestMethod -Uri "$OverpassUrl`?data=$encodedQuery" -Headers $headers
    $features = [System.Collections.Generic.List[object]]::new()

    foreach ($element in @($response.elements)) {
        $access = $element.tags.access
        $bicycle = $element.tags.bicycle
        $service = $element.tags.service
        $allowsBicycles = $bicycle -in @("yes", "designated", "permissive")
        if (($access -in @("no", "private") -and -not $allowsBicycles) -or
            $bicycle -in @("no", "private") -or
            $service -in @("drive-through", "emergency_access")) {
            continue
        }

        $path = @(
            $element.geometry | ForEach-Object {
                ,@([double] $_.lon, [double] $_.lat)
            }
        )
        if ($path.Count -lt 2) {
            continue
        }

        $roadClass = switch ($service) {
            "parking_aisle" { "OSM_PARKING_AISLE" }
            "driveway" { "OSM_DRIVEWAY" }
            default { "OSM_SERVICE" }
        }
        $features.Add(
            [ordered]@{
                id = "osm:way:$($element.id)"
                sourceLayerId = "osm-service"
                sourceLayerName = "OpenStreetMap Service Roads"
                objectId = $element.id
                oid = $element.id
                name = if ([string]::IsNullOrWhiteSpace($element.tags.name)) { $null } else { $element.tags.name.Trim() }
                baseName = $null
                mtfcc = $roadClass
                routeType = $null
                osmHighway = "service"
                osmService = $service
                osmAccess = $access
                osmBicycle = $bicycle
                paths = @(,$path)
            }
        ) | Out-Null
    }

    return @($features)
}

$normalizedTigerLayers = foreach ($layer in $layers) {
    $metadata = Invoke-RestMethod -Uri "$($layer.url)?f=json"
    $features = Get-LayerFeatures $layer

    [ordered]@{
        id = $layer.id
        name = $layer.name
        url = $layer.url
        geometryType = $metadata.geometryType
        featureCount = $features.Count
        features = @($features)
    }
}

$osmFeatures = Get-OsmServiceFeatures
$osmLayer = [ordered]@{
    id = "osm-service"
    name = "OpenStreetMap Service Roads"
    url = $OverpassUrl
    geometryType = "polyline"
    featureCount = $osmFeatures.Count
    attribution = "OpenStreetMap contributors"
    features = @($osmFeatures)
}

$output = [ordered]@{
    job = "Trail Mapper normalized ordinary endpoint access roads"
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    sources = $sources
    layers = @($normalizedTigerLayers) + @($osmLayer)
}

Write-GeneratedAsset -Value $output -Path $fullOutputPath
Write-Host "Wrote $fullOutputPath"
