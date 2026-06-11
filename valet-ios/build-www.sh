#!/bin/sh
# Bundle the valet web app into the Capacitor webDir.
# Run before `npx cap sync ios` whenever the web app changes.
set -e
cd "$(dirname "$0")"
SRC="../jays-air-center-website/valet/app"
rm -rf www
mkdir -p www
# SETUP.md is repo docs; sw.js is web-only (the native shell bundles assets,
# and index.html gates registration off capacitor: anyway).
rsync -a --exclude "SETUP.md" --exclude "sw.js" "$SRC/" www/
echo "www/ rebuilt from $SRC"
