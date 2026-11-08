# Stage the SDK import library in the engine build cache for Duck manifests.
param([string]$Sdk = $env:VULKAN_SDK)
$ErrorActionPreference = 'Stop'
if (!$Sdk) { $Sdk = [Environment]::GetEnvironmentVariable('VULKAN_SDK', 'Machine') }
if (!$Sdk) { $Sdk = [Environment]::GetEnvironmentVariable('VULKAN_SDK', 'User') }
if (!$Sdk) { throw 'Install the Vulkan SDK or set VULKAN_SDK before building for Windows.' }
$source = Join-Path $Sdk 'Lib/vulkan-1.lib'
$cache = Join-Path $PSScriptRoot '.duck/vulkan'
New-Item -ItemType Directory -Path $cache -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $cache -Force
