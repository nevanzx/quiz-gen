$ErrorActionPreference = "Stop"

# Installs BOTH halves of the quiz-gen package into OpenCode:
#   1. the companion plugin (the `quiz_ui` tool + spec UI), and
#   2. the quiz-gen skill path (so the skill is discovered).
# One command, then restart OpenCode.

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pluginsDir = Join-Path $HOME ".config\opencode\plugins"
$configPath = Join-Path $HOME ".config\opencode\opencode.json"

# --- 1. plugin (UI + quiz_ui tool) -----------------------------------------
New-Item -ItemType Directory -Force -Path $pluginsDir | Out-Null
Copy-Item -Path (Join-Path $repo "plugin\*") -Destination $pluginsDir -Recurse -Force
Write-Host "Installed plugin files to $pluginsDir"

# --- 2. skill path ----------------------------------------------------------
if (Test-Path $configPath) {
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
} else {
  $config = [pscustomobject]@{ '$schema' = 'https://opencode.ai/config.json' }
}

if (-not $config.PSObject.Properties['skills']) {
  $config | Add-Member -NotePropertyName skills -NotePropertyValue ([pscustomobject]@{ paths = @() })
}
if (-not $config.skills.PSObject.Properties['paths']) {
  $config.skills | Add-Member -NotePropertyName paths -NotePropertyValue @()
}

$skillPath = $repo -replace '\\', '/'
$paths = @($config.skills.paths)
if ($paths -notcontains $skillPath) {
  $config.skills.paths = @($paths + $skillPath)
  Write-Host "Registered skill path: $skillPath"
} else {
  Write-Host "Skill path already registered: $skillPath"
}

$config | ConvertTo-Json -Depth 10 | Set-Content -Path $configPath -Encoding UTF8
Write-Host "Updated $configPath"
Write-Host "Restart OpenCode for the plugin and skill to load."
