param(
    [ValidateSet('debug', 'release')]
    [string]$Profile = 'debug',
    [ValidateSet('core', 'headless', 'windows')]
    [string]$Platform = 'core',
    [string]$DuckRoot = (Join-Path $PSScriptRoot '../Duck')
)
$ErrorActionPreference = 'Stop'
$builder = Join-Path $DuckRoot 'duck.cmd'
if (-not (Test-Path -LiteralPath $builder)) {
    throw "Duck build launcher not found: $builder. Supply -DuckRoot."
}
$manifest = switch ($Platform) {
    'core' { 'Quaxel.dkp' }
    'headless' { 'Quaxel.Headless.dkp' }
    'windows' { 'Quaxel.Windows.dkp' }
}
& $builder build (Join-Path $PSScriptRoot $manifest) --profile $Profile
exit $LASTEXITCODE
