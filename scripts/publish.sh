#!/usr/bin/env bash
# Publishing helper for a WorkCraft open-source repository (workcraft-ai or workcraft). Bash version of publish.ps1.
#
# SAFE BY DEFAULT: commands that change something only PRINT what they would do. Add --execute to really do it.
# The script never asks for, stores or prints a token: the GitHub CLI (gh) keeps its own sign-in (gh auth login).
#
#   scripts/publish.sh status
#   scripts/publish.sh check                         scan for keys, tokens, private keys, personal paths, binaries, big files
#   scripts/publish.sh init [--execute]              git init, branch main, remote origin
#   scripts/publish.sh create [--execute]            create the empty GitHub repository with gh
#   scripts/publish.sh push -m "Initial public alpha" [--execute] [--yes]
#   scripts/publish.sh meta [--execute]              description, homepage, topics, Issues and Discussions on
#   scripts/publish.sh labels [--execute]            labels from .github/labels.yml
#   scripts/publish.sh changelog [--new] [--execute]
#   scripts/publish.sh release [--local] [--execute] tag v<version> and publish a GitHub PRE-RELEASE
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CMD="${1:-help}"; shift || true
EXECUTE=0; YES=0; LOCAL=0; NEW=0; MESSAGE=""; BRANCH="main"; REPO_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --execute) EXECUTE=1 ;;
    --yes) YES=1 ;;
    --local) LOCAL=1 ;;
    --new) NEW=1 ;;
    -m|--message) MESSAGE="$2"; shift ;;
    --repo) REPO_OVERRIDE="$2"; shift ;;
    --branch) BRANCH="$2"; shift ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

CFG=".github/repo.json"
[ -f "$CFG" ] || { echo "Missing $CFG" >&2; exit 2; }
json_str() { sed -n "s/.*\"$1\": *\"\\([^\"]*\\)\".*/\\1/p" "$CFG" | head -n1; }
REPO="${REPO_OVERRIDE:-$(json_str repo)}"
DESC="$(json_str description)"
HOMEPAGE="$(json_str homepage)"
VISIBILITY="$(json_str visibility)"
TOPICS="$(sed -n '/"topics"/,/\]/p' "$CFG" | grep -o '"[a-z0-9-]*"' | grep -v '^"topics"$' | tr -d '"' || true)"
IS_CARGO=0; [ -f Cargo.toml ] && IS_CARGO=1

version() {
  if [ -f Cargo.toml ]; then sed -n 's/^version *= *"\([^"]*\)".*/\1/p' Cargo.toml | head -n1
  else sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' package.json | head -n1; fi
}
need() { command -v "$1" >/dev/null 2>&1 || { echo "'$1' is not installed or not on PATH." >&2; exit 2; }; }
run() {
  if [ "$EXECUTE" = 1 ]; then printf '> %s\n' "$*"; "$@"; else printf '(dry run) %s\n' "$*"; fi
}
has_git() { [ -d .git ]; }

publish_files() {
  need git
  if has_git; then git ls-files -co --exclude-standard
  else
    tmp="$(mktemp -d)"; git init --quiet --bare "$tmp"
    git --git-dir="$tmp" --work-tree="$ROOT" ls-files -co --exclude-standard
    rm -rf "$tmp"
  fi | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done
}

cmd_check() {
  ver="$(version)"; echo "Checking $REPO (version $ver)"
  errors=0; warnings=0
  files="$(publish_files)"; echo "  $(printf '%s\n' "$files" | grep -c . || true) files would be published"
  bad_names='(^|/)(\.env(\..*)?|keys\.json|config\.json|control\.json|id_rsa.*|id_ed25519.*)$|\.(pem|key|p12|pfx|sqlite3?|db|exe|dll|pdb|msi|dmg|zip)$|(^|/)private/|\.local\.|\.secret\.'
  secret_re='sk-[A-Za-z0-9_-]{20,}|(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|xox[abprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  home_re='[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\|/home/[a-z][a-z0-9_-]+/|/Users/[A-Za-z][A-Za-z0-9_-]+/'
  fake_re='test|example|fake|dummy|sample|placeholder|xxxx|0123456789|your[-_ ]?key|<|runner|username|/Users/Shared|Users\\(Public|Default)'
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if printf '%s' "$f" | grep -Eq "$bad_names" && ! printf '%s' "$f" | grep -Eq '(^|/)\.env\.example$'; then
      echo "  FAIL  $f  (a file that must not be published)"; errors=$((errors+1)); continue; fi
    size=$(wc -c < "$f")
    if [ "$size" -gt 99614720 ]; then echo "  FAIL  $f is over 95 MB (GitHub refuses files over 100 MB)"; errors=$((errors+1)); continue; fi
    if [ "$size" -gt 52428800 ]; then echo "  WARN  $f is over 50 MB"; warnings=$((warnings+1)); fi
    case "$f" in *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.icns|*.woff|*.woff2|*.ttf|*.otf|*.wasm|*.pdf|*.docx|*.xlsx|*.pptx|*.mp3|*.mp4|*.wav|*.bin|*.gz|*.lock|*.svg|package-lock.json) continue ;; esac
    [ "$size" -gt 2097152 ] && continue
    hits="$(grep -InE "$secret_re" "$f" 2>/dev/null | grep -Eiv "$fake_re" || true)"
    hits="$hits$(grep -InE "$home_re" "$f" 2>/dev/null | grep -Eiv "$fake_re" || true)"
    if [ -n "$hits" ]; then printf '%s\n' "$hits" | head -n 3 | sed "s|^|  FAIL  $f:|" | cut -c1-140; errors=$((errors+1)); fi
  done <<EOF
$files
EOF
  for r in README.md LICENSE-MIT LICENSE-APACHE CHANGELOG.md CONTRIBUTING.md CODE_OF_CONDUCT.md SECURITY.md .gitignore \
           .github/pull_request_template.md .github/ISSUE_TEMPLATE/config.yml .github/labels.yml .github/repo.json; do
    if [ -f "$r" ]; then echo "  ok    $r"; else echo "  FAIL  missing $r"; errors=$((errors+1)); fi
  done
  grep -Eq "^## \[$(printf '%s' "$ver" | sed 's/[.[\*^$]/\\&/g')\]" CHANGELOG.md \
    && echo "  ok    CHANGELOG.md has an entry for $ver" || { echo "  FAIL  CHANGELOG.md has no entry for $ver"; errors=$((errors+1)); }
  grep -qi alpha README.md || { echo "  FAIL  README.md does not say that the project is an alpha"; errors=$((errors+1)); }
  [ -d docs/images ] || { echo "  WARN  no screenshots yet: add PNG/GIF files to docs/images/ (see docs/PUBLISHING.md)"; warnings=$((warnings+1)); }
  echo
  if [ "$errors" -gt 0 ]; then echo "  FAIL  $errors error(s), $warnings warning(s). Fix the errors before you push."; exit 1; fi
  echo "  ok    no errors, $warnings warning(s)"
}

cmd_status() {
  echo "Repository : $REPO"; echo "Version    : $(version)"; echo "Folder     : $ROOT"
  has_git || { echo "  WARN  not a git repository yet (run: publish.sh init --execute)"; return; }
  echo "Branch     : $(git branch --show-current)"
  echo "Remote     : $(git remote get-url origin 2>/dev/null || echo '(none)')"
  echo "Changes    : $(git status --short | wc -l | tr -d ' ') file(s)"
  echo "Last commit: $(git log -1 --format='%h %s' 2>/dev/null || echo '(none)')"
}

cmd_init() {
  need git
  has_git || run git init -b "$BRANCH"
  url="https://github.com/$REPO.git"
  cur="$(git remote get-url origin 2>/dev/null || true)"
  if [ -z "$cur" ]; then run git remote add origin "$url"
  elif [ "$cur" != "$url" ]; then echo "  WARN  origin was $cur"; run git remote set-url origin "$url"
  else echo "  ok    origin = $url"; fi
  [ -d .githooks ] && run git config core.hooksPath .githooks
  [ "$EXECUTE" = 1 ] || echo "Nothing changed (dry run). Add --execute to apply."
}

cmd_create() {
  need gh
  vis="--public"; [ "$VISIBILITY" = private ] && vis="--private"
  run gh repo create "$REPO" "$vis" --description "$DESC"
}

cmd_push() {
  need git; has_git || { echo "Not a git repository. Run: publish.sh init --execute" >&2; exit 2; }
  "$0" check
  msg="${MESSAGE:-Update to $(version)}"
  run git add -A
  if [ "$EXECUTE" = 1 ]; then
    echo "$(git diff --cached --name-only | wc -l | tr -d ' ') file(s) staged."
    if [ "$YES" != 1 ]; then
      printf "Commit with the message '%s' and push to origin/%s? Type yes: " "$msg" "$BRANCH"; read -r a
      [ "$a" = yes ] || { git reset --quiet; echo "Cancelled. Nothing was committed."; exit 1; }
    fi
  fi
  run git commit -m "$msg"
  run git branch -M "$BRANCH"
  run git push -u origin "$BRANCH"
  [ "$EXECUTE" = 1 ] || echo "Dry run. Add --execute to commit and push."
}

cmd_meta() {
  need gh
  args=(repo edit "$REPO" --description "$DESC" --homepage "$HOMEPAGE" --enable-issues --enable-discussions --enable-wiki=false --enable-projects=false)
  for t in $TOPICS; do args+=(--add-topic "$t"); done
  for t in $(gh repo view "$REPO" --json repositoryTopics --jq '.repositoryTopics[].name' 2>/dev/null || true); do
    printf '%s\n' $TOPICS | grep -qx "$t" || args+=(--remove-topic "$t")
  done
  run gh "${args[@]}"
  echo "Description (${#DESC} of 350 characters): $DESC"
  echo "Topics ($(printf '%s\n' $TOPICS | grep -c .) of 20): $(printf '%s ' $TOPICS)"
}

cmd_labels() {
  need gh
  name=""; color=""
  while IFS= read -r line; do
    case "$line" in
      "- name:"*) name="${line#- name: }" ;;
      "  color:"*) color="${line#  color: }" ;;
      "  description:"*) run gh label create "$name" --repo "$REPO" --color "$color" --description "${line#  description: }" --force ;;
    esac
  done < .github/labels.yml
}

changelog_section() {
  awk -v v="## [$1]" 'index($0, v)==1 {p=1; next} /^## \[/ {p=0} p' CHANGELOG.md
}

cmd_changelog() {
  ver="$(version)"; sec="$(changelog_section "$ver")"
  if [ -n "$sec" ]; then echo "## [$ver]"; echo "$sec"; return; fi
  echo "  WARN  CHANGELOG.md has no entry for $ver"
  if [ "$NEW" = 1 ]; then
    entry="## [$ver] - $(date +%F)

### What changed

- (describe the change here)
"
    if [ "$EXECUTE" = 1 ]; then
      tmp="$(mktemp)"; awk -v e="$entry" '!d && /^## \[/ {print e; print ""; d=1} {print}' CHANGELOG.md > "$tmp" && mv "$tmp" CHANGELOG.md
      echo "  ok    Entry added for $ver. Edit it, then run check."
    else printf '(dry run) would add:\n%s\n' "$entry"; fi
  else echo "Run with --new --execute to add an empty entry."; fi
}

cmd_release() {
  need git; need gh
  "$0" check
  ver="$(version)"; tag="v$ver"; notes="$(mktemp)"
  if [ -f "docs/releases/$ver.md" ]; then cp "docs/releases/$ver.md" "$notes"
  else sec="$(changelog_section "$ver")"; printf '%s\n' "${sec:-Alpha build $ver. See CHANGELOG.md.}" > "$notes"; fi
  printf '\n\n> **Alpha.** This is a pre-release. Expect bugs and changes between alphas.\n' >> "$notes"
  has_git || { echo "Not a git repository. Run init and push first." >&2; exit 2; }
  [ -z "$(git status --short)" ] || echo "  WARN  There are uncommitted changes. Run push first so the tag points at what you tested."
  has_tag=0; [ -n "$(git tag -l "$tag")" ] && has_tag=1
  if [ "$IS_CARGO" = 1 ] && [ "$LOCAL" != 1 ]; then
    [ "$has_tag" = 1 ] || run git tag -a "$tag" -m "WorkCraft AI $ver"
    run git push origin "$tag"
    echo "The release workflow now builds the Windows files and publishes the pre-release (Actions tab)."
    return
  fi
  assets=()
  if [ "$IS_CARGO" = 1 ]; then
    echo "  WARN  --local on this system builds a native binary (the Windows .exe files come from Windows or from the workflow)."
    run cargo build --release -p workcraft-app -p workcraft-cli
    out="dist/release"; mkdir -p "$out" 2>/dev/null || true
    for b in workcraft workcraft-cli; do [ -f "target/release/$b" ] && cp "target/release/$b" "$out/" && assets+=("$out/$b"); done
    ( cd "$out" && sha256sum workcraft* > SHA256SUMS.txt 2>/dev/null ) && assets+=("$out/SHA256SUMS.txt") || true
  fi
  [ "$has_tag" = 1 ] || run git tag -a "$tag" -m "$ver"
  run git push origin "$tag"
  run gh release create "$tag" "${assets[@]}" --repo "$REPO" --title "${REPO#*/} $ver" --notes-file "$notes" --prerelease --verify-tag
  [ "$EXECUTE" = 1 ] || echo "Dry run. Add --execute to tag, push and publish."
}

case "$CMD" in
  status) cmd_status ;;
  check) cmd_check ;;
  init) cmd_init ;;
  create) cmd_create ;;
  push) cmd_push ;;
  meta) cmd_meta ;;
  labels) cmd_labels ;;
  changelog) cmd_changelog ;;
  release) cmd_release ;;
  all) "$0" check && cmd_init && cmd_meta && cmd_labels ;;
  help|*) sed -n '2,16p' "$0" ;;
esac
