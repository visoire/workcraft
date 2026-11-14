# Serves this folder on http://localhost:<free port>/ and opens it in the default browser.
# The web build is a WebAssembly app: browsers refuse to load it from file://, so double-clicking
# index.html only shows "Loading...". This server needs no install and no admin rights, listens on
# this computer only (127.0.0.1) and stops when you close the window.
param([string]$App = 'the app', [int]$Port = 0, [switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path)).TrimEnd('\') + '\'
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript'; '.wasm' = 'application/wasm'
  '.ico' = 'image/x-icon'; '.png' = 'image/png'; '.json' = 'application/json'; '.css' = 'text/css'
  '.md' = 'text/plain; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $listener.Start() }
$url = "http://localhost:$($listener.LocalEndpoint.Port)/"

$Host.UI.RawUI.WindowTitle = "$App - $url"
Write-Host ""
Write-Host "  $App is running at $url" -ForegroundColor Green
Write-Host "  Keep this window open while you work. Close it to stop $App."
Write-Host "  Your files stay on this computer: the server only answers this PC."
Write-Host ""
if (-not $NoOpen) { Start-Process $url }

function Send($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body, [string]$path) {
  $head = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
  $h = [Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($h, 0, $h.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    # Browsers open spare connections they never use; do not wait on them forever.
    $stream.ReadTimeout = 3000
    $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 8192, $true)
    $line = $reader.ReadLine()
    while ($true) { $h = $reader.ReadLine(); if ($null -eq $h -or $h -eq '') { break } }
    if (-not $line) { continue }
    $parts = $line.Split(' ')
    $method = $parts[0]
    $rel = [Uri]::UnescapeDataString(($parts[1] -split '\?')[0]).TrimStart('/')
    if ($rel -eq '' -or $rel.EndsWith('/')) { $rel += 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
      Send $stream 404 'Not Found' 'text/plain' ([Text.Encoding]::UTF8.GetBytes('Not found')) $rel
      continue
    }
    $type = $types[[IO.Path]::GetExtension($file).ToLower()]
    if (-not $type) { $type = 'application/octet-stream' }
    $bytes = if ($method -eq 'HEAD') { [byte[]]@() } else { [IO.File]::ReadAllBytes($file) }
    Send $stream 200 'OK' $type $bytes $rel
  } catch {
    # A closed or idle connection; keep serving.
  } finally {
    $client.Close()
  }
}
