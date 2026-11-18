# Starts WorkCraft on Windows. Double-click "Start WorkCraft.cmd" (it calls this file).
# No administrator rights. If the computer has no Node 22 or newer, a private copy of Node is downloaded from nodejs.org into
# the folder .runtime (checked against nodejs.org's SHASUMS256.txt), nothing is installed on the system.
param([Parameter(ValueFromRemainingArguments = $true)] $Rest)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

function Test-NodeOk($exe) {
  try { $v = (& $exe -v) | Select-Object -First 1; return ([int]($v.TrimStart('v').Split('.')[0]) -ge 22) } catch { return $false }
}

$node = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd -and (Test-NodeOk $cmd.Source)) { $node = $cmd.Source }
$local = Join-Path $root '.runtime\node\node.exe'
if (-not $node -and (Test-Path $local) -and (Test-NodeOk $local)) { $node = $local }

if (-not $node) {
  Write-Host 'WorkCraft needs Node 22 or newer. Fetching a private copy into .runtime (one time, about 30 MB) ...'
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $index = Invoke-RestMethod 'https://nodejs.org/dist/index.json'
  $version = ($index | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1).version
  if (-not $version) { throw 'Could not find a Node 22 release on nodejs.org.' }
  $cpu = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $name = "node-$version-win-$cpu.zip"
  $tmp = Join-Path $env:TEMP $name
  Invoke-WebRequest "https://nodejs.org/dist/$version/$name" -OutFile $tmp -UseBasicParsing
  $sums = (Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing).Content
  $want = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($name) } | Select-Object -First 1).Split(' ')[0].Trim()
  $got = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower()
  if ($want -ne $got) { Remove-Item $tmp -Force; throw "The download of $name does not match nodejs.org's checksum. Nothing was installed." }
  $rt = Join-Path $root '.runtime'
  New-Item -ItemType Directory -Force $rt | Out-Null
  Expand-Archive $tmp -DestinationPath $rt -Force
  Remove-Item $tmp -Force
  $dir = Join-Path $rt ([IO.Path]::GetFileNameWithoutExtension($name))
  if (Test-Path (Join-Path $rt 'node')) { Remove-Item (Join-Path $rt 'node') -Recurse -Force }
  Rename-Item $dir 'node'
  $node = $local
  Write-Host "Node $version is ready."
}

& $node (Join-Path $root 'scripts\setup.mjs') @Rest
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host ''
  Write-Host 'WorkCraft could not be started. The lines above say why. Ask your AI assistant to "set up WorkCraft", or see SETUP-AI.md in this folder.'
  if ([Environment]::UserInteractive -and -not ($Rest -contains '--yes')) { cmd /c pause }
}
exit $code
