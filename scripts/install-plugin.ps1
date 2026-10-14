$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repo "plugin"
$dest = Join-Path $HOME ".config\opencode\plugins"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $src "*") -Destination $dest -Recurse -Force
Write-Host "Installed quiz-gen plugin files to $dest"
Write-Host "Restart OpenCode for the plugin to load."
