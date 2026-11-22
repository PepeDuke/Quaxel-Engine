param(
    [ValidateSet('debug', 'release')]
    [string]$Profile = 'debug',
    [ValidateSet('core', 'headless', 'windows', 'web')]
    [string]$Platform = 'core',
    [string]$DuckRoot = (Join-Path $PSScriptRoot '../Duck')
)
$ErrorActionPreference = 'Stop'
$builder = Join-Path $DuckRoot 'duck.cmd'
if (-not (Test-Path -LiteralPath $builder)) {
    throw "Duck build launcher not found: $builder. Supply -DuckRoot."
}
$manifest = switch ($Platform) {
    'web' { 'Quaxel.Web.dkp' }
    'core' { 'Quaxel.dkp' }
    'headless' { 'Quaxel.Headless.dkp' }
    'windows' { 'Quaxel.Windows.dkp' }
}
if ($Platform -eq 'windows') { & (Join-Path $PSScriptRoot 'configure-vulkan.ps1') }
& python (Join-Path $PSScriptRoot 'Tools/Qvoxc/compile.py') (Join-Path $PSScriptRoot 'Tests/Fixtures') --duck-root $DuckRoot
if ($LASTEXITCODE) { exit $LASTEXITCODE }
if ($Platform -eq 'web') {
    & (Join-Path $PSScriptRoot './Tools/Web/build.ps1') -Builder $builder -Manifest (Join-Path $PSScriptRoot $manifest) -Profile $Profile
    exit $LASTEXITCODE
}
& $builder build (Join-Path $PSScriptRoot $manifest) --profile $Profile
exit $LASTEXITCODE
