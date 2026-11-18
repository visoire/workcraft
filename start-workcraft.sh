#!/bin/sh
# Starts WorkCraft on macOS and Linux. No administrator rights, nothing installed on the system.
#   sh start-workcraft.sh            set up (first time), start, open the browser, ask about autostart
#   sh start-workcraft.sh --yes      no questions (what an AI assistant runs)
# If the computer has no Node 22 or newer, a private copy is downloaded from nodejs.org into .runtime/ and checked
# against nodejs.org's SHASUMS256.txt. Other options: see scripts/setup.mjs.
set -eu
cd "$(dirname "$0")"
ROOT="$(pwd)"

node_ok() { [ -x "$1" ] || command -v "$1" >/dev/null 2>&1 || return 1; v="$("$1" -v 2>/dev/null | sed 's/^v//;s/\..*//')"; [ -n "$v" ] && [ "$v" -ge 22 ] 2>/dev/null; }

NODE=""
if command -v node >/dev/null 2>&1 && node_ok node; then NODE="$(command -v node)"; fi
if [ -z "$NODE" ] && [ -x "$ROOT/.runtime/node/bin/node" ] && node_ok "$ROOT/.runtime/node/bin/node"; then NODE="$ROOT/.runtime/node/bin/node"; fi

if [ -z "$NODE" ]; then
  echo "WorkCraft needs Node 22 or newer. Fetching a private copy into .runtime (one time, about 40 MB) ..."
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) echo "Unsupported system: $(uname -s)"; exit 2 ;; esac
  case "$(uname -m)" in x86_64|amd64) cpu=x64 ;; arm64|aarch64) cpu=arm64 ;; *) echo "Unsupported CPU: $(uname -m)"; exit 2 ;; esac
  version="$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v22\.[0-9.]*"' | head -n 1 | sed 's/"version":"//;s/"//')"
  [ -n "$version" ] || { echo "Could not find a Node 22 release on nodejs.org."; exit 2; }
  name="node-$version-$os-$cpu.tar.gz"
  tmp="$(mktemp -d)"
  curl -fsSL "https://nodejs.org/dist/$version/$name" -o "$tmp/$name"
  curl -fsSL "https://nodejs.org/dist/$version/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  want="$(grep " $name\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
  if command -v sha256sum >/dev/null 2>&1; then got="$(sha256sum "$tmp/$name" | cut -d' ' -f1)"; else got="$(shasum -a 256 "$tmp/$name" | cut -d' ' -f1)"; fi
  [ "$want" = "$got" ] || { echo "The download of $name does not match nodejs.org's checksum. Nothing was installed."; rm -rf "$tmp"; exit 2; }
  mkdir -p "$ROOT/.runtime"
  tar -xzf "$tmp/$name" -C "$ROOT/.runtime"
  rm -rf "$ROOT/.runtime/node"
  mv "$ROOT/.runtime/node-$version-$os-$cpu" "$ROOT/.runtime/node"
  rm -rf "$tmp"
  NODE="$ROOT/.runtime/node/bin/node"
  echo "Node $version is ready."
fi

# a private Node has its npm next to it: put it first on the PATH for this run
PATH="$(dirname "$NODE"):$PATH"
export PATH
exec "$NODE" "$ROOT/scripts/setup.mjs" "$@"
