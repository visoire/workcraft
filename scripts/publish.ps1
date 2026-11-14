<#
.SYNOPSIS
  Publishing helper for a WorkCraft open-source repository (workcraft-ai or workcraft). Windows PowerShell 5.1 or PowerShell 7.

.DESCRIPTION
  One script, the same file in both repositories. It reads .github/repo.json (repository, description, topics) and works out
  the rest from the folder (Cargo.toml = WorkCraft AI, package.json = the workspace).

  SAFE BY DEFAULT: every command that would change anything (git commit, git push, GitHub settings, labels, releases) only
  PRINTS what it would do. Add -Execute to really do it. Nothing is ever uploaded without -Execute, and the script never
  asks for, stores or prints a token: the GitHub CLI (gh) keeps its own sign-in (gh auth login).

  Commands:
    status      Branch, remote, version, what changed.
    check       Scans the files that would be published for keys, tokens, private keys, personal paths, binaries and big
                files, and checks that the community files exist. Run it before every push. Exit code 1 on errors.
    init        git init (if needed), branch main, remote origin = https://github.com/<repo>.git.
    create      Creates the empty GitHub repository with gh (skip this if you created it in the browser).
    push        check, then git add -A, commit and git push. First push: pass -Message "Initial public alpha".
    meta        Sets the description, homepage and topics (and Issues/Discussions on) with gh repo edit.
    labels      Creates or updates the labels from .github/labels.yml.
    changelog   Shows the CHANGELOG entry of the current version; -New adds an empty entry for it when missing.
    release     Tags v<version> and publishes a GitHub PRE-RELEASE. WorkCraft AI: pushing the tag makes the
                release workflow build the Windows .exe; with -Local the exe files are built here and attached.
    all         check, init, meta, labels (the first-time sequence; push and release stay separate on purpose).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 check
  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 push -Message "Initial public alpha" -Execute
  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 meta -Execute
  powershell -ExecutionPolicy Bypass -File scripts/publish.ps1 release -Local -Execute
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('help', 'status', 'check', 'init', 'create', 'push', 'meta', 'labels', 'changelog', 'release', 'all')]
  [string]$Command = 'help',
  [switch]$Execute,
  [string]$Message,
  [string]$Repo,
  [string]$Branch = 'main',
  [switch]$Local,
  [switch]$New,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# ---------------------------------------------------------------------------------------------------------------------
# Configuration
$configFile = Join-Path $root '.github/repo.json'
if (-not (Test-Path $configFile)) { throw "Missing .github/repo.json in $root" }
$cfg = Get-Content -Raw -Encoding UTF8 $configFile | ConvertFrom-Json
if (-not $Repo) { $Repo = $cfg.repo }
$isCargo = Test-Path (Join-Path $root 'Cargo.toml')
$isNode = Test-Path (Join-Path $root 'package.json')

function Get-ProjectVersion {
  if ($isCargo) {
    $m = [regex]::Match((Get-Content -Raw (Join-Path $root 'Cargo.toml')), '(?m)^version\s*=\s*"([^"]+)"')
    if ($m.Success) { return $m.Groups[1].Value }
  }
  if ($isNode) { return (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version }
  throw 'No version found (Cargo.toml or package.json)'
}

# ---------------------------------------------------------------------------------------------------------------------
# Helpers
function Info($t) { Write-Host $t }
function Ok($t) { Write-Host "  ok    $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  WARN  $t" -ForegroundColor Yellow }
function Bad($t) { Write-Host "  FAIL  $t" -ForegroundColor Red }
function Need($name) { if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "'$name' is not installed or not on PATH." } }

# A command that changes something: printed always, run only with -Execute.
function Do-It {
  param([string]$Exe, [string[]]$CmdArgs)
  $shown = ($CmdArgs | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '
  if ($Execute) {
    Write-Host "> $Exe $shown" -ForegroundColor Cyan
    & $Exe @CmdArgs
    if ($LASTEXITCODE -ne 0) { throw "$Exe failed with exit code $LASTEXITCODE" }
  } else {
    Write-Host "(dry run) $Exe $shown" -ForegroundColor DarkGray
  }
}

# A read-only command: always runs, returns its output lines.
function Read-It {
  param([string]$Exe, [string[]]$CmdArgs)
  $out = & $Exe @CmdArgs 2>$null
  if ($null -eq $out) { return @() }
  return @($out)
}

function Has-Git { Test-Path (Join-Path $root '.git') }

# The files that would be published: tracked plus untracked, minus everything .gitignore excludes.
# Works before the first git init too, with a temporary empty git dir that only reads .gitignore.
function Get-PublishFiles {
  Need git
  if (Has-Git) {
    $list = Read-It git @('ls-files', '-co', '--exclude-standard')
  } else {
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('wc-publish-' + [Guid]::NewGuid().ToString('n'))
    git init --quiet --bare $tmp | Out-Null
    try { $list = Read-It git @("--git-dir=$tmp", "--work-tree=$root", 'ls-files', '-co', '--exclude-standard') }
    finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
  }
  # git quotes odd names; keep the plain ones and skip deleted files
  $list | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $root $_) -PathType Leaf) }
}

# ---------------------------------------------------------------------------------------------------------------------
# check
function Cmd-Check {
  Info "Checking $Repo (version $(Get-ProjectVersion))"
  $errors = 0; $warnings = 0
  $files = @(Get-PublishFiles)
  Info "  $($files.Count) files would be published"

  $secretRules = @(
    @{ Name = 'OpenAI/DeepSeek style key'; Re = 'sk-[A-Za-z0-9_\-]{20,}' },
    @{ Name = 'Anthropic key'; Re = 'sk-ant-[A-Za-z0-9_\-]{20,}' },
    @{ Name = 'GitHub token'; Re = '\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|github_pat_[A-Za-z0-9_]{40,}' },
    @{ Name = 'AWS access key'; Re = '\bAKIA[0-9A-Z]{16}\b' },
    @{ Name = 'Google API key'; Re = '\bAIza[0-9A-Za-z_\-]{35}\b' },
    @{ Name = 'Slack token'; Re = '\bxox[abprs]-[A-Za-z0-9\-]{10,}' },
    @{ Name = 'Private key block'; Re = '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
    @{ Name = 'Hard-coded secret'; Re = '(?i)\b(api[_-]?key|secret|token|passwd|password)\b["'']?\s*[:=]\s*["''][A-Za-z0-9_\-/+=]{24,}["'']' },
    @{ Name = 'Personal home path'; Re = '(?i)\b[A-Z]:\\Users\\(?!<|%|\{|Public\b|Default\b|you\b|name\b|username\b|YourName\b|example\b)[^\\\s`"''<>|]+\\|/home/(?!<|you\b|name\b|username\b|runner\b|user\b)[a-z][a-z0-9_-]+/|/Users/(?!<|you\b|name\b|username\b|Shared\b)[A-Za-z][A-Za-z0-9_-]+/' }
  )
  $fake = '(?i)test|example|fake|dummy|sample|placeholder|xxxx|0123456789|your[-_ ]?key|<'
  $badNames = '(^|/)(\.env(\..*)?|keys\.json|config\.json|control\.json|id_rsa.*|id_ed25519.*)$|\.(pem|key|p12|pfx|sqlite3?|db|exe|dll|pdb|msi|dmg|zip)$|(^|/)private/|\.local\.|\.secret\.'
  $skipText = '\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|wasm|pdf|docx|xlsx|pptx|mp3|mp4|wav|bin|gz|7z|tar|lock|svg)$|(^|/)package-lock\.json$|(^|/)Cargo\.lock$'

  foreach ($f in $files) {
    $norm = $f -replace '\\', '/'
    if ($norm -match $badNames -and $norm -notmatch '(^|/)\.env\.example$') { Bad "$norm  (a file that must not be published)"; $errors++; continue }
    $full = Join-Path $root $f
    $len = (Get-Item -LiteralPath $full).Length
    if ($len -gt 95MB) { Bad "$norm is $([math]::Round($len / 1MB)) MB (GitHub refuses files over 100 MB)"; $errors++; continue }
    if ($len -gt 50MB) { Warn "$norm is $([math]::Round($len / 1MB)) MB (GitHub warns above 50 MB; the limit is 100 MB)"; $warnings++ }
    if ($norm -match $skipText -or $len -gt 2MB) { continue }
    $text = $null
    try { $text = [IO.File]::ReadAllText($full) } catch { continue }
    if ($text.Contains([char]0)) { continue }
    $n = 0
    foreach ($line in ($text -split "`n")) {
      $n++
      foreach ($rule in $secretRules) {
        $mm = [regex]::Match($line, $rule.Re)
        if (-not $mm.Success) { continue }
        if ($rule.Name -ne 'Personal home path' -and $mm.Value -match $fake) { continue }
        $shown = $mm.Value; if ($shown.Length -gt 12) { $shown = $shown.Substring(0, 6) + '...' }
        Bad "$norm`:$n  $($rule.Name) ($shown)"; $errors++
        break
      }
    }
  }

  $required = @('README.md', 'LICENSE-MIT', 'LICENSE-APACHE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'SECURITY.md',
    '.gitignore', '.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/config.yml', '.github/labels.yml', '.github/repo.json')
  foreach ($r in $required) { if (Test-Path (Join-Path $root $r)) { Ok $r } else { Bad "missing $r"; $errors++ } }
  if (-not ((Get-ChildItem (Join-Path $root '.github/ISSUE_TEMPLATE') -Filter '*.yml' -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'config.yml' }))) { Bad 'no issue form in .github/ISSUE_TEMPLATE'; $errors++ }

  $ver = Get-ProjectVersion
  $cl = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'CHANGELOG.md')
  if ($cl -match "(?m)^## \[$([regex]::Escape($ver))\]") { Ok "CHANGELOG.md has an entry for $ver" } else { Bad "CHANGELOG.md has no entry for $ver (run: publish.ps1 changelog -New)"; $errors++ }
  if ($ver -notmatch '-') { Warn "version $ver is not an alpha/pre-release version; releases are always published as pre-releases anyway"; $warnings++ }
  $readme = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'README.md')
  if ($readme -notmatch '(?i)alpha') { Bad 'README.md does not say that the project is an alpha'; $errors++ }
  $readme = [regex]::Replace($readme, '(?s)<!--.*?-->', '')   # commented-out screenshots do not count
  if ($readme -match '(?m)^\s*<img [^>]*docs/images/' -and -not (Test-Path (Join-Path $root 'docs/images'))) { Bad 'README.md shows docs/images/* but the folder does not exist'; $errors++ }
  elseif (-not (Test-Path (Join-Path $root 'docs/images'))) { Warn 'no screenshots yet: add PNG/GIF files to docs/images/ and show them in the README (see docs/PUBLISHING.md)'; $warnings++ }

  Write-Host ''
  if ($errors -gt 0) { Bad "$errors error(s), $warnings warning(s). Fix the errors before you push."; exit 1 }
  Ok "no errors, $warnings warning(s)"
}

# ---------------------------------------------------------------------------------------------------------------------
function Cmd-Status {
  Need git
  Info "Repository : $Repo"
  Info "Version    : $(Get-ProjectVersion)"
  Info "Folder     : $root"
  if (-not (Has-Git)) { Warn 'not a git repository yet (run: publish.ps1 init -Execute)'; return }
  Info "Branch     : $(Read-It git @('branch', '--show-current'))"
  $remote = Read-It git @('remote', 'get-url', 'origin')
  Info "Remote     : $(if ($remote) { $remote } else { '(none)' })"
  if ($remote -and $remote -notmatch [regex]::Escape($Repo)) { Warn "origin is not $Repo. 'init -Execute' fixes it." }
  $dirty = @(Read-It git @('status', '--short'))
  Info "Changes    : $($dirty.Count) file(s)"
  $last = Read-It git @('log', '-1', '--format=%h %s')
  Info "Last commit: $(if ($last) { $last } else { '(none)' })"
}

function Cmd-Init {
  Need git
  if (-not (Has-Git)) { Do-It git @('init', '-b', $Branch) } else { Ok 'already a git repository' }
  $url = "https://github.com/$Repo.git"
  $cur = if (Has-Git) { Read-It git @('remote', 'get-url', 'origin') } else { @() }
  if (-not $cur) { Do-It git @('remote', 'add', 'origin', $url) }
  elseif ($cur -ne $url) { Warn "origin was $cur"; Do-It git @('remote', 'set-url', 'origin', $url) }
  else { Ok "origin = $url" }
  if (Test-Path (Join-Path $root '.githooks')) { Do-It git @('config', 'core.hooksPath', '.githooks') }
  if (-not $Execute) { Info "`nNothing changed (dry run). Add -Execute to apply." }
}

function Cmd-Create {
  Need gh
  $vis = if ($cfg.visibility -eq 'private') { '--private' } else { '--public' }
  Do-It gh @('repo', 'create', $Repo, $vis, '--description', $cfg.description)
  Info 'The repository is empty. Next: publish.ps1 init -Execute, then push.'
}

function Cmd-Push {
  Need git
  if (-not (Has-Git)) { throw 'Not a git repository. Run: publish.ps1 init -Execute' }
  & $PSCommandPath check
  if ($LASTEXITCODE -ne 0) { throw 'check failed: nothing was committed.' }
  $ver = Get-ProjectVersion
  $msg = if ($Message) { $Message } else { "Update to $ver" }
  Info "`nStaging everything that .gitignore allows..."
  Do-It git @('add', '-A')
  $staged = @(Read-It git @('diff', '--cached', '--name-status'))
  if ($Execute) {
    Info "$($staged.Count) file(s) staged. Top-level folders:"
    $staged | ForEach-Object { ($_ -split "`t")[-1] -replace '/.*$', '' } | Sort-Object -Unique | ForEach-Object { Info "  $_" }
    if (-not $Yes) {
      $answer = Read-Host "Commit with the message '$msg' and push to origin/$Branch? Type yes"
      if ($answer -ne 'yes') { git reset --quiet; throw 'Cancelled. Nothing was committed.' }
    }
  }
  Do-It git @('commit', '-m', $msg)
  Do-It git @('branch', '-M', $Branch)
  Do-It git @('push', '-u', 'origin', $Branch)
  if (-not $Execute) { Info "`nDry run. Add -Execute to commit and push." }
}

function Cmd-Meta {
  Need gh
  $args1 = @('repo', 'edit', $Repo, '--description', $cfg.description, '--homepage', $cfg.homepage)
  if ($cfg.features.issues) { $args1 += '--enable-issues' }
  if ($cfg.features.discussions) { $args1 += '--enable-discussions' }
  if (-not $cfg.features.wiki) { $args1 += '--enable-wiki=false' }
  if (-not $cfg.features.projects) { $args1 += '--enable-projects=false' }
  foreach ($t in $cfg.topics) { $args1 += @('--add-topic', $t) }
  # remove topics that are on GitHub but no longer in repo.json
  $existing = @()
  try { $existing = @(& gh repo view $Repo --json repositoryTopics --jq '.repositoryTopics[].name' 2>$null) } catch { }
  foreach ($t in $existing) { if ($t -and ($cfg.topics -notcontains $t)) { $args1 += @('--remove-topic', $t) } }
  Do-It gh $args1
  Info "`nDescription ($($cfg.description.Length) of 350 characters): $($cfg.description)"
  Info "Topics ($($cfg.topics.Count) of 20): $($cfg.topics -join ', ')"
}

function Cmd-Labels {
  Need gh
  $text = Get-Content -Raw -Encoding UTF8 (Join-Path $root '.github/labels.yml')
  $items = [regex]::Matches($text, '(?m)^- name:\s*(.+)\r?\n\s+color:\s*([0-9a-fA-F]{6})\r?\n\s+description:\s*(.*)')
  foreach ($m in $items) {
    $name = $m.Groups[1].Value.Trim().Trim('"'); $color = $m.Groups[2].Value; $desc = $m.Groups[3].Value.Trim()
    Do-It gh @('label', 'create', $name, '--repo', $Repo, '--color', $color, '--description', $desc, '--force')
  }
  Info "$($items.Count) label(s)"
}

function Get-ChangelogSection([string]$ver) {
  $cl = Get-Content -Raw -Encoding UTF8 (Join-Path $root 'CHANGELOG.md')
  $m = [regex]::Match($cl, "(?ms)^## \[$([regex]::Escape($ver))\][^\n]*\n(.*?)(?=^## \[|\z)")
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return $null
}

function Cmd-Changelog {
  $ver = Get-ProjectVersion
  $sec = Get-ChangelogSection $ver
  if ($sec) { Info "## [$ver]`n$sec"; return }
  Warn "CHANGELOG.md has no entry for $ver"
  if ($New) {
    $path = Join-Path $root 'CHANGELOG.md'
    $text = Get-Content -Raw -Encoding UTF8 $path
    $date = Get-Date -Format 'yyyy-MM-dd'
    $entry = "## [$ver] - $date`n`n### What changed`n`n- (describe the change here)`n`n"
    $m = [regex]::Match($text, '(?m)^## \[')
    if (-not $m.Success) { throw 'No existing entry to insert before.' }
    $new = $text.Insert($m.Index, $entry)
    if ($Execute) { [IO.File]::WriteAllText($path, $new, (New-Object Text.UTF8Encoding($false))); Ok "Entry added for $ver. Edit it, then run check." }
    else { Info "(dry run) would add:`n$entry" }
  } else { Info 'Run with -New -Execute to add an empty entry.' }
}

function Cmd-Release {
  Need git; Need gh
  & $PSCommandPath check
  if ($LASTEXITCODE -ne 0) { throw 'check failed: no release was made.' }
  $ver = Get-ProjectVersion
  $tag = "v$ver"
  $notesFile = Join-Path $root "docs/releases/$ver.md"
  $notes = Join-Path ([IO.Path]::GetTempPath()) "wc-notes-$ver.md"
  if (Test-Path $notesFile) { Copy-Item $notesFile $notes -Force }
  else {
    $sec = Get-ChangelogSection $ver
    if (-not $sec) { $sec = "Alpha build $ver. See CHANGELOG.md." }
    Set-Content -Path $notes -Value $sec -Encoding UTF8
  }
  Add-Content -Path $notes -Encoding UTF8 -Value "`n`n> **Alpha.** This is a pre-release. Expect bugs and changes between alphas.$(if ($isCargo) { ' Windows is the only verified platform and the binaries are not code-signed: check them against SHA256SUMS.txt.' })"
  Info "Release $tag for $Repo (a PRE-RELEASE). Notes: $notes"

  if (-not (Has-Git)) { throw 'Not a git repository. Run init and push first.' }
  $dirty = @(Read-It git @('status', '--short'))
  if ($dirty.Count -gt 0) { Warn 'There are uncommitted changes. Run push first so the tag points at what you tested.' }
  $hasTag = [bool](Read-It git @('tag', '-l', $tag))
  if ($isCargo -and -not $Local) {
    # CI path: the tag push starts .github/workflows/release.yml, which builds the exe and creates the pre-release.
    if (-not $hasTag) { Do-It git @('tag', '-a', $tag, '-m', "WorkCraft AI $ver") } else { Ok "tag $tag exists" }
    Do-It git @('push', 'origin', $tag)
    Info "`nThe release workflow now builds the Windows files and publishes the pre-release (Actions tab). Use -Local to build and upload from this computer instead."
    return
  }
  $assets = @()
  if ($isCargo) {
    $cargo = (Get-Command cargo -ErrorAction SilentlyContinue)
    if (-not $cargo -and (Test-Path "$env:USERPROFILE\.cargo\bin\cargo.exe")) { $env:Path += ";$env:USERPROFILE\.cargo\bin" }
    Need cargo
    $out = Join-Path $root 'dist/release'
    Do-It cargo @('build', '--release', '-p', 'workcraft-app', '-p', 'workcraft-cli')
    if ($Execute) {
      New-Item -ItemType Directory -Force $out | Out-Null
      Copy-Item (Join-Path $root 'target/release/workcraft.exe') (Join-Path $out 'WorkCraft.exe') -Force
      Copy-Item (Join-Path $root 'target/release/workcraft-cli.exe') (Join-Path $out 'WorkCraft-CLI.exe') -Force
      $sums = Get-ChildItem $out -Filter '*.exe' | ForEach-Object { "$((Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower())  $($_.Name)" }
      Set-Content -Path (Join-Path $out 'SHA256SUMS.txt') -Value $sums -Encoding ascii
      Info ($sums -join "`n")
    }
    $assets = @((Join-Path $out 'WorkCraft.exe'), (Join-Path $out 'WorkCraft-CLI.exe'), (Join-Path $out 'SHA256SUMS.txt'))
  }
  if (-not $hasTag) { Do-It git @('tag', '-a', $tag, '-m', "$ver") } else { Ok "tag $tag exists" }
  Do-It git @('push', 'origin', $tag)
  Do-It gh (@('release', 'create', $tag) + $assets + @('--repo', $Repo, '--title', "$($cfg.repo.Split('/')[1]) $ver", '--notes-file', $notes, '--prerelease', '--verify-tag'))
  if (-not $Execute) { Info "`nDry run. Add -Execute to build, tag, push and publish." }
}

switch ($Command) {
  'help' { Get-Help $PSCommandPath -Detailed }
  'status' { Cmd-Status }
  'check' { Cmd-Check }
  'init' { Cmd-Init }
  'create' { Cmd-Create }
  'push' { Cmd-Push }
  'meta' { Cmd-Meta }
  'labels' { Cmd-Labels }
  'changelog' { Cmd-Changelog }
  'release' { Cmd-Release }
  'all' { & $PSCommandPath check; if ($LASTEXITCODE -eq 0) { Cmd-Init; Cmd-Meta; Cmd-Labels } }
}
