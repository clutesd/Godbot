#!/usr/bin/env bash
# Usage: scripts/perf/svg-tile-shot.sh <out.png> <archetype> <period> [scenario] [seed] [layer]
set -e
out=$1; shift
html="${out%.png}.html"
npx tsx scripts/perf/svg-tile-sheet.ts "$html" "$@"
edge="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
"$edge" --headless=new --disable-gpu --hide-scrollbars --window-size=1840,1000 --screenshot="$(cygpath -w "$PWD/$out" 2>/dev/null || echo "$PWD/$out")" "file:///$(cygpath -m "$PWD/$html" 2>/dev/null || echo "$PWD/$html")" >/dev/null 2>&1
