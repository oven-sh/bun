#!/usr/bin/env bash

set -euo pipefail

killall -9 "$(basename "$BUN_BIN")" || echo ""

DIR=$(mktemp -d -t bun-dev-check)

index_content="<html><body>index.html</body></html>"
bacon_content="<html><body>bacon.html</body></html>"
js_content="console.log('hi')"

mkdir -p "$DIR/public"

echo $index_content >"$DIR/public/index.html"
echo $js_content >"$DIR/index.js"
echo $bacon_content >"$DIR/public/bacon.html"

cd "$DIR"

$BUN_BIN dev --port 8087 &
sleep 0.005

if [ "$(curl --fail -sS http://localhost:8087/)" != "$index_content" ]; then
    echo "ERR: Expected '$index_content', got '$(curl --fail -sS http://localhost:8087/)'"
    exit 1
fi

if [ "$(curl --fail -sS http://localhost:8087/index)" != "$index_content" ]; then
    echo "ERR: Expected '$index_content', got '$(curl --fail -sS http://localhost:8087/index)'"
    exit 1
fi

if [ "$(curl --fail -sS http://localhost:8087/index.html)" != "$index_content" ]; then
    echo "ERR: Expected '$index_content', got '$(curl --fail -sS http://localhost:8087/index.html)'"
    exit 1
fi

if [ "$(curl --fail -sS http://localhost:8087/foo/foo)" != "$index_content" ]; then
    echo "ERR: Expected '$index_content', got '$(curl --fail -sS http://localhost:8087/index.html)'"
    exit 1
fi

if [ "$(curl --fail -sS http://localhost:8087/bacon)" != "$bacon_content" ]; then
    echo "ERR: Expected '$index_content', got '$(curl --fail -sS http://localhost:8087/bacon)'"
    exit 1
fi

if [ "$(curl --fail -sS http://localhost:8087/bacon.html)" != "$bacon_content" ]; then
    echo "ERR: Expected '$index_content', got '$(curl --fail -sS http://localhost:8087/bacon.html)'"
    exit 1
fi

killall -9 $(basename $BUN_BIN) || echo ""
echo "✅ bun dev index html check passed."
