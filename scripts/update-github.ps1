<#
.SYNOPSIS
  One command that brings the public GitHub repository (visoire/workcraft) up to the version in package.json:
  checks, commit, push, tag and a NEW pre-release. Windows PowerShell 5.1 or PowerShell 7.

.DESCRIPTION
  What it does, in order:
    1. Looks at the tools (git, gh, node, npm) and at your GitHub sign-in (gh auth status). It never asks for or prints a token.
    2. Reads the version from package.json (0.1.0-alpha.N) and refuses to go on when the tag v<version> already exists here or on GitHub:
       a release that exists is never replaced, moved or deleted. Raise the number first (docs/PUBLISHING.md, "Every later release").
    3. Runs the project checks: typecheck, unit tests, check:clean, check:docs, build, then scripts/publish.ps1 check (keys, tokens, personal
       paths, big files). -SkipChecks skips the first five (publish.ps1 check always runs).
    4. Commits everything .gitignore allows and pushes to origin/main (scripts/publish.ps1 push). Normal push, never a force push.
    5. Tags v<version> and pushes the tag. .github/workflows/release.yml then publishes the PRE-RELEASE with docs/releases/<version>.md.
       The script waits for it; when the workflow does not publish within -WaitSeconds, the script creates the pre-release itself with gh.
    6. Prints the release page and the list of releases, so you can see the older ones are still there.

  SAFE BY DEFAULT: without -Execute nothing is committed, pushed, tagged or published; the script only prints the plan and runs the read-only
  checks. The older release (v0.1.0-alpha.1 and any other) is only listed, never touched.

.PARAMETER Execute      Really commit, push, tag and release.
.PARAMETER Message      Commit message (default: "WorkCraft <version>").
.PARAMETER SkipChecks   Skip typecheck, tests, check:clean, check:docs and build (publish.ps1 check still runs).
.PARAMETER Meta         Also refresh the repository description, topics and labels (publish.ps1 meta and labels).
.PARAMETER WaitSeconds  How long to wait for the release workflow (default 240).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/update-github.ps1                 # dry run
  powershell -ExecutionPolicy Bypass -File scripts/update-github.ps1 -Execute        # do it
  scripts\update-github.cmd -Execute -Meta                                           # the same from cmd
#>
[CmdletBinding()]
param(
  [switch]$Execute,
  [string]$Message,
  [switch]$SkipChecks,
  [switch]$Meta,
  [int]$WaitSeconds = 240
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Say($t) { Write-Host $t }
function Ok($t) { Write-Host "  ok    $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  WARN  $t" -ForegroundColor Yellow }
function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Need($n) { if (-not (Get-Command $n -ErrorAction SilentlyContinue)) { throw "'$n' is not installed or not on PATH." } }
# A native command that must succeed (the exit code is checked; PowerShell 5.1 does not do that by itself)
function Run {
  param([string]$Exe, [string[]]$CmdArgs)
  Write-Host "> $Exe $($CmdArgs -join ' ')" -ForegroundColor DarkGray
  & $Exe @CmdArgs
  if ($LASTEXITCODE -ne 0) { throw "$Exe $($CmdArgs -join ' ') failed with exit code $LASTEXITCODE" }
}
# Exit code of a command whose failure is an answer, not an error (PowerShell 5.1 turns text on stderr into an exception under 'Stop')
function Code { param([string]$Exe, [string[]]$CmdArgs) $p = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { & $Exe @CmdArgs 2>$null | Out-Null; return $LASTEXITCODE } finally { $ErrorActionPreference = $p } }
# A read-only command: output as lines, no error on failure
function Peek { param([string]$Exe, [string[]]$CmdArgs) $o = & $Exe @CmdArgs 2>$null; if ($null -eq $o) { @() } else { @($o) } }

Step 'Tools and sign-in'
Need git; Need gh; Need node; Need npm
$cfg = Get-Content -Raw -Encoding UTF8 (Join-Path $root '.github/repo.json') | ConvertFrom-Json
$repo = $cfg.repo
if ((Code gh @('auth', 'status')) -ne 0) { throw 'GitHub CLI is not signed in. Run: gh auth login (browser sign-in, no token is pasted anywhere).' }
Ok "gh is signed in; repository $repo"
$origin = (Peek git @('remote', 'get-url', 'origin')) -join ''
if ($origin -notmatch [regex]::Escape($repo)) { throw "origin is '$origin', expected github.com/$repo. Fix it: git remote set-url origin https://github.com/$repo.git" }
$branch = (Peek git @('branch', '--show-current')) -join ''
if ($branch -ne 'main') { throw "You are on '$branch'. Switch to main first." }

Step 'Version'
$ver = (Get-Content -Raw (Join-Path $root 'package.json') | ConvertFrom-Json).version
$tag = "v$ver"
$tsVersion = [regex]::Match((Get-Content -Raw (Join-Path $root 'src/core/version.ts')), "VERSION = '([^']+)'").Groups[1].Value
if ($tsVersion -ne $ver) { throw "src/core/version.ts says $tsVersion but package.json says $ver. Keep them equal." }
$notes = Join-Path $root "docs/releases/$ver.md"
if (-not (Test-Path $notes)) { throw "docs/releases/$ver.md is missing: write the release notes first." }
if (-not (Select-String -Path (Join-Path $root 'CHANGELOG.md') -Pattern "^## \[$([regex]::Escape($ver))\]" -Quiet)) { throw "CHANGELOG.md has no entry for $ver." }
Ok "version $ver, tag $tag, notes docs/releases/$ver.md"
& git fetch origin --tags --quiet
if ((Peek git @('tag', '-l', $tag)).Count -gt 0) { throw "The tag $tag already exists here. A release is never replaced: raise the version number." }
if ((Peek git @('ls-remote', '--tags', 'origin', "refs/tags/$tag")).Count -gt 0) { throw "The tag $tag already exists on GitHub. A release is never replaced: raise the version number." }
Ok "$tag is new"
Say "`nReleases on GitHub now (they stay untouched):"
Peek gh @('release', 'list', '--repo', $repo, '--limit', '20') | ForEach-Object { Say "  $_" }

if (-not $SkipChecks) {
  Step 'Project checks'
  Run npm @('run', 'typecheck')
  Run npm @('test')
  Run npm @('run', 'check:clean')
  Run npm @('run', 'check:docs')
  Run npm @('run', 'build')
} else { Warn 'project checks skipped (-SkipChecks)' }

Step 'Publish check (keys, tokens, personal paths, big files)'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'publish.ps1') check
if ($LASTEXITCODE -ne 0) { throw 'publish.ps1 check found errors. Nothing was committed.' }

$msg = if ($Message) { $Message } else { "WorkCraft $ver" }
Step 'What would be published'
$dirty = @(Peek git @('status', '--short'))
Say "  $($dirty.Count) changed file(s) to commit with the message: $msg"
$dirty | Select-Object -First 12 | ForEach-Object { Say "    $_" }
if ($dirty.Count -gt 12) { Say "    ... and $($dirty.Count - 12) more" }
Say "  then: git push origin main; git tag -a $tag; git push origin $tag; a pre-release '$repo $tag' with docs/releases/$ver.md"

if (-not $Execute) {
  Say "`nDry run: nothing was changed. Add -Execute to commit, push, tag and release."
  exit 0
}

Step 'Commit and push'
Run git @('add', '-A')
$staged = @(Peek git @('diff', '--cached', '--name-only'))
if ($staged.Count -gt 0) { Run git @('commit', '-m', $msg) } else { Ok 'nothing new to commit' }
Run git @('push', 'origin', 'main')

Step "Tag $tag"
Run git @('tag', '-a', $tag, '-m', "WorkCraft $ver")
Run git @('push', 'origin', $tag)

Step 'Pre-release'
$deadline = (Get-Date).AddSeconds($WaitSeconds)
$found = $false
Say "Waiting for the release workflow (up to $WaitSeconds s) ..."
while ((Get-Date) -lt $deadline) {
  if ((Code gh @('release', 'view', $tag, '--repo', $repo)) -eq 0) { $found = $true; break }
  Start-Sleep -Seconds 8
}
if ($found) { Ok 'the workflow published the release' }
else {
  Warn 'the workflow did not publish in time; creating the pre-release here'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) "wc-notes-$ver.md"
  Copy-Item $notes $tmp -Force
  Add-Content -Path $tmp -Encoding UTF8 -Value "`n`n> **Alpha.** This is a pre-release. Expect bugs and changes between alphas."
  Run gh @('release', 'create', $tag, '--repo', $repo, '--title', "WorkCraft $ver", '--notes-file', $tmp, '--prerelease', '--verify-tag')
}
$view = Peek gh @('release', 'view', $tag, '--repo', $repo, '--json', 'url,isPrerelease,tagName', '--jq', '.url + " prerelease=" + (.isPrerelease|tostring)')
Say "`nRelease: $($view -join ' ')"

if ($Meta) {
  Step 'Repository description, topics and labels'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'publish.ps1') meta -Execute
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'publish.ps1') labels -Execute
}

Step 'Releases on GitHub now'
Peek gh @('release', 'list', '--repo', $repo, '--limit', '20') | ForEach-Object { Say "  $_" }
Say "`nDone. https://github.com/$repo/releases/tag/$tag"
Say "Next, for the website (private repo): update public/workspace.json and public/changelog.json to $ver, build, upload (docs/PUBLISHING.md, section 7)."
