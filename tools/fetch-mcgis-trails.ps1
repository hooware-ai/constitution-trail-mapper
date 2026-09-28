<#
Job: Fetch McLean County GIS trail polylines and normalize them for Trail Mapper routing prototypes.

#>

[CmdletBinding()]
param(
    [string] $OutputPath = "data/generated/mcgis-trails.normalized.json"
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

$sources = @{
    officialTrailMapsPage = "https://www.constitutiontrail.org/trail-maps"
    arcGisAppId = "d98c151296fd4b03860af8f4df7787a4"
    webMapId = "7470738236b04a66893f13ecbcd9fe05"
}

$layers = @(
    @{
        id = 54
        name = "Constitution Trail Branches"
        url = "https://www.mcgisweb.org/mcgc/rest/services/Recreation/Trails/MapServer/54"
    },
    @{
        id = 16
        name = "Other Trails"
        url = "https://www.mcgisweb.org/mcgc/rest/services/Recreation/Trails/MapServer/16"
    }
)

function Get-DomainLabel {
    param(
        [object] $Metadata,
        [string] $FieldName,
        [object] $Code
    )

    if ($null -eq $Code) {
        return $null
    }

    $field = $Metadata.fields | Where-Object { $_.name -eq $FieldName } | Select-Object -First 1
    if ($null -eq $field -or $null -eq $field.domain) {
        return $null
    }

    $match = $field.domain.codedValues | Where-Object { $_.code -eq $Code } | Select-Object -First 1
    if ($null -eq $match) {
        return $null
    }

    return $match.name
}

function Add-IfMissing {
    param(
        [System.Collections.Generic.List[string]] $Items,
        [string] $Value
    )

    if (-not [string]::IsNullOrWhiteSpace($Value) -and -not $Items.Contains($Value)) {
        $Items.Add($Value) | Out-Null
    }
}

function Get-RouteRoles {
    param(
        [int] $LayerId,
        [object] $Attributes
    )

    $roles = [System.Collections.Generic.List[string]]::new()

    if ($LayerId -eq 54) {
        Add-IfMissing $roles "TrailBranches"
    }

    if ($LayerId -eq 16 -and ($Attributes.systemname -eq 3 -or $Attributes.systemname -eq 4) -and $Attributes.activitytype -eq 2) {
        Add-IfMissing $roles "ParkConnectors"
    }

    if ($LayerId -eq 16 -and $Attributes.systemname -eq 4 -and $Attributes.activitytype -eq 1) {
        Add-IfMissing $roles "SharedRoadways"
    }

    if ($LayerId -eq 54 -and ($Attributes.facilitytype -eq 1 -or $Attributes.facilitytype -eq 4)) {
        Add-IfMissing $roles "SharedRoadways"
    }

    if ($Attributes.status -eq 2) {
        Add-IfMissing $roles "ProposedTrails"
    }

    return @($roles)
}

function Convert-Feature {
    param(
        [int] $LayerId,
        [string] $LayerName,
        [object] $Metadata,
        [object] $Feature
    )

    $attributes = $Feature.attributes
    $statusLabel = Get-DomainLabel $Metadata "status" $attributes.status
    $surfaceLabel = Get-DomainLabel $Metadata "SURFTYPE" $attributes.SURFTYPE
    $comfortLabel = Get-DomainLabel $Metadata "loc" $attributes.loc
    $facilityTypeLabel = Get-DomainLabel $Metadata "facilitytype" $attributes.facilitytype
    $activityTypeLabel = Get-DomainLabel $Metadata "activitytype" $attributes.activitytype
    $systemNameLabel = Get-DomainLabel $Metadata "systemname" $attributes.systemname
    $routeRoles = Get-RouteRoles $LayerId $attributes

    return [ordered]@{
        id = "$($LayerId):$($attributes.OBJECTID)"
        sourceLayerId = $LayerId
        sourceLayerName = $LayerName
        objectId = $attributes.OBJECTID
        facilityId = $attributes.FACILITYID
        name = if ([string]::IsNullOrWhiteSpace($attributes.NAME)) { $null } else { $attributes.NAME.Trim() }
        lengthMiles = $attributes.LENGTH
        statusCode = $attributes.status
        status = $statusLabel
        surfaceTypeCode = $attributes.SURFTYPE
        surfaceType = $surfaceLabel
        comfortCode = $attributes.loc
        comfort = $comfortLabel
        facilityTypeCode = $attributes.facilitytype
        facilityType = $facilityTypeLabel
        activityTypeCode = $attributes.activitytype
        activityType = $activityTypeLabel
        systemNameCode = $attributes.systemname
        systemName = $systemNameLabel
        routeRoles = @($routeRoles)
        enabledByDefault = ($attributes.status -ne 2 -and $routeRoles.Count -gt 0)
        paths = $Feature.geometry.paths
    }
}

$normalizedLayers = foreach ($layer in $layers) {
    $metadata = Invoke-RestMethod -Uri "$($layer.url)?f=json"
    $query = "$($layer.url)/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=json"
    $features = (Invoke-RestMethod -Uri $query).features
    $normalizedFeatures = foreach ($feature in $features) {
        Convert-Feature $layer.id $layer.name $metadata $feature
    }

    [ordered]@{
        id = $layer.id
        name = $layer.name
        url = $layer.url
        geometryType = $metadata.geometryType
        featureCount = $features.Count
        features = @($normalizedFeatures)
    }
}

$output = [ordered]@{
    job = "Trail Mapper normalized McLean County GIS trail network"
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    sources = $sources
    layers = @($normalizedLayers)
}

Write-GeneratedAsset -Value $output -Path $fullOutputPath
Write-Host "Wrote $fullOutputPath"
