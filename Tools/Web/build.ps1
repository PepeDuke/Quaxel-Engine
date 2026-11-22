param([string]$Builder, [string]$Manifest, [string]$Profile, [string[]]$AssetExtensions)
$ErrorActionPreference = 'Stop'
$previous = $env:EMCC_CFLAGS
try {
    $env:EMCC_CFLAGS = "$previous -sJSPI -sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=8GB -sINITIAL_MEMORY=128MB -sSTACK_SIZE=16MB -sEXPORTED_RUNTIME_METHODS=FS -Wno-unused-command-line-argument"
    & $Builder build $Manifest --profile $Profile --target wasm64
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
    & python (Join-Path $PSScriptRoot 'package.py') $Manifest $Profile @AssetExtensions
    exit $LASTEXITCODE
} finally {
    $env:EMCC_CFLAGS = $previous
}
