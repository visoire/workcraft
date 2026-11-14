# Repacks the four web-build zips with a one-click launcher, into <set>/zip-web/.
# The release set and app list come from public/releases.json; afterwards the script writes
# each repacked zip's exact size back into that file (webZipBytes).
# The original zips hold a static site that only runs behind a web server: double-clicking its
# index.html opens a page stuck on "Loading...". The repacked zip adds
#   Start <App>.cmd   Windows: serves the folder on localhost and opens the browser (serve.ps1)
#   start.sh          macOS and Linux: the same with python3
#   START HERE.txt    what to double-click and why
# Run from the project root:  powershell -ExecutionPolicy Bypass -File scripts/pack-web-zips.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$manifest = 'public/releases.json'
$rel = Get-Content -Raw -Encoding UTF8 $manifest | ConvertFrom-Json
$src = $rel.set
$out = Join-Path $src 'zip-web'
$launcher = 'scripts/web-launcher'
$apps = @($rel.apps | ForEach-Object { @{ id = $_.app; name = $_.name; web = $_.web } })
$sizes = @{}

# Startup fixes first (scripts/patch-apps.mjs), so the zips carry the same files as apps/<app>/
node scripts/patch-apps.mjs
if ($LASTEXITCODE -ne 0) { throw 'scripts/patch-apps.mjs failed; the zips were not packed' }
New-Item -ItemType Directory -Force $out | Out-Null
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("oc-pack-" + [Guid]::NewGuid().ToString('n'))
$crlf = { param($s) ($s -replace "`r?`n", "`r`n") }
$utf8 = [Text.UTF8Encoding]::new($false)

foreach ($a in $apps) {
  $dir = Join-Path $tmp $a.web
  Copy-Item -Recurse (Join-Path $src "web/$($a.web)") $dir

  Copy-Item (Join-Path $launcher 'serve.ps1') $dir
  $cmd = @"
@echo off
rem Starts $($a.name) in your browser. Keep the window open while you work; close it to stop.
title $($a.name)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -App "$($a.name)"
if errorlevel 1 pause
"@
  [IO.File]::WriteAllText((Join-Path $dir "Start $($a.name).cmd"), (& $crlf $cmd), [Text.Encoding]::ASCII)

  $sh = @"
#!/bin/sh
# Starts $($a.name) in your browser on macOS or Linux. Needs python3. Stop with Ctrl+C.
cd "`$(dirname "`$0")" || exit 1
PORT=`${PORT:-8765}
URL="http://localhost:`$PORT/"
echo "$($a.name) is running at `$URL (Ctrl+C to stop)"
( sleep 1; open "`$URL" 2>/dev/null || xdg-open "`$URL" 2>/dev/null ) &
exec python3 -m http.server "`$PORT" --bind 127.0.0.1
"@
  [IO.File]::WriteAllText((Join-Path $dir 'start.sh'), ($sh -replace "`r`n", "`n"), $utf8)

  $readme = @"
$($a.name) for the web
=======================

Windows
  Double-click "Start $($a.name).cmd". $($a.name) opens in your browser.
  Keep the small black window open while you work, close it to stop.

macOS and Linux
  Open a terminal in this folder and run:  sh start.sh
  Then open http://localhost:8765/ if the browser does not open by itself.

Why not just open index.html?
  $($a.name) is a WebAssembly app. Browsers do not load those from a file on disk,
  so index.html opened directly stays on "Loading $($a.name)...". The launcher serves
  this folder on your own computer only (localhost). Nothing is uploaded.

Hosting it on a server
  Upload everything in this folder to any static web host. HOSTING.md has the details.
  The launcher files (Start $($a.name).cmd, serve.ps1, start.sh, this file) are not needed there.

Needs a current Chrome, Edge, Firefox or Safari with WebGPU or WebGL2.
"@
  [IO.File]::WriteAllText((Join-Path $dir 'START HERE.txt'), (& $crlf $readme), $utf8)

  $zip = Join-Path $out "$($a.web).zip"
  if (Test-Path $zip) { Remove-Item $zip }
  # Entries with forward slashes: ZipFile.CreateFromDirectory on Windows PowerShell writes
  # backslashes, which macOS and Linux unzip into one flat file per path.
  $archive = [IO.Compression.ZipFile]::Open((Join-Path (Resolve-Path $out) "$($a.web).zip"), 'Create')
  try {
    $base = (Resolve-Path $dir).Path.TrimEnd('\') + '\'
    foreach ($f in Get-ChildItem -LiteralPath $dir -Recurse -File -Force) {
      $entry = "$($a.web)/" + $f.FullName.Substring($base.Length).Replace('\', '/')
      [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $entry, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
  } finally { $archive.Dispose() }
  $sizes[$a.id] = (Get-Item $zip).Length
  '{0}  {1:N1} MB ({2} bytes)' -f $zip, ($sizes[$a.id] / 1MB), $sizes[$a.id]
}
Remove-Item -Recurse -Force $tmp

# Write the exact sizes back into releases.json, touching only the "webZipBytes" values
$text = [IO.File]::ReadAllText((Resolve-Path $manifest))
foreach ($id in $sizes.Keys) {
  $pattern = '("app":\s*"' + $id + '"[\s\S]*?"webZipBytes":\s*)\d+'
  $text = [regex]::new($pattern).Replace($text, ('${1}' + $sizes[$id]), 1)
}
[IO.File]::WriteAllText((Resolve-Path $manifest), $text, $utf8)
"updated webZipBytes in $manifest"
