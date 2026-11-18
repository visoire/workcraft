#!/bin/sh
# macOS: double-click this file in Finder to start WorkCraft (no administrator rights).
# The first time, macOS may ask you to allow it: right-click the file, choose Open, then Open.
cd "$(dirname "$0")" || exit 1
sh ./start-workcraft.sh "$@"
status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo "WorkCraft could not be started. The lines above say why. Ask your AI assistant to \"set up WorkCraft\", or see SETUP-AI.md in this folder."
  printf "Press Return to close this window. "
  read -r _
fi
exit "$status"
