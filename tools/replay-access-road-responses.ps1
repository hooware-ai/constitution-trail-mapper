<# Replay archived public responses through the unchanged native extractor. No network calls. #>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Archive,
    [Parameter(Mandatory = $true)] [string] $OutputPath
)
$ErrorActionPreference = "Stop"
$capture = Get-Content -LiteralPath (Join-Path $Archive "capture.json") -Raw | ConvertFrom-Json -DateKind String
if ($capture.status -notin @("responses-captured", "captured-and-audited-not-admitted")) {
    throw "Archive has not completed response capture"
}
foreach ($tool in $capture.tools) {
    $current = (Get-FileHash -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) $tool.file) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($current -ne $tool.sha256) { throw "Review tool changed: $($tool.file)" }
}
$responses = @{}
$consumed = @{}
foreach ($request in $capture.requests) {
    $path = Join-Path $Archive $request.file
    if ((Get-Item -LiteralPath $path).Length -ne $request.bytes -or
        (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $request.sha256 -or
        $request.status -ne 200) { throw "Archived response failed integrity: $($request.file)" }
    if ($request.file -eq "metadata.json" -or $request.file -eq "overpass.json" -or $request.file.StartsWith("page-")) {
        if ($responses.ContainsKey($request.url)) { throw "Duplicate extractor response URL" }
        $responses[$request.url] = $path
    }
}
function Get-Date { [datetime]::Parse($capture.normalizationTimestampUtc, [Globalization.CultureInfo]::InvariantCulture) }
function Invoke-RestMethod {
    param([string] $Uri, [object] $Headers)
    if (-not $responses.ContainsKey($Uri)) { throw "Extractor requested an uncaptured URL: $Uri" }
    $consumed[$Uri] = $true
    Get-Content -LiteralPath $responses[$Uri] -Raw | ConvertFrom-Json -DateKind String
}
& (Join-Path $PSScriptRoot "fetch-tigerweb-access-roads.ps1") -OutputPath $OutputPath
if ($consumed.Count -ne $responses.Count) { throw "Extractor did not consume every captured response" }
# The native extractor has an unordered source-metadata hashtable. Canonicalize
# object keys only for the web review; arrays retain native feature/path order.
& python (Join-Path $PSScriptRoot "canonicalize-access-road-review.py") $OutputPath
if ($LASTEXITCODE -ne 0) { throw "Canonical web-review serialization failed" }
