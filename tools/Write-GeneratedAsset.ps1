<#
Job: Replace a generated routing asset only after its new content is completely written.

#>

function Write-GeneratedAsset {
    param(
        [Parameter(Mandatory = $true)] $Value,
        [Parameter(Mandatory = $true)] [string] $Path
    )

    # Serialize fully, then write beside the asset and swap it in, so a failed or interrupted
    # run (Ctrl+C, crash, full disk) leaves the last usable asset in place.
    $fullPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $json = $Value | ConvertTo-Json -Depth 100
    $temporaryPath = "$fullPath.tmp"
    try {
        Set-Content -LiteralPath $temporaryPath -Value $json -Encoding UTF8
        if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
            # [NullString] means "no backup"; a PowerShell $null would arrive as an empty path.
            [System.IO.File]::Replace($temporaryPath, $fullPath, [NullString]::Value)
        } else {
            [System.IO.File]::Move($temporaryPath, $fullPath)
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}
