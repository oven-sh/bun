#!/usr/bin/env bash

set -euo pipefail

# The important part of this test: make sure that bun.js successfully loads
# The most likely reason for this test to fail is that something broke in the JavaScriptCore <> bun integration
killall -9 "$(basename "$BUN_BIN")" || echo ""

DIR=$(mktemp -d -t next-app)
$BUN_BIN create next "$DIR"

if (($?)); then
    echo "bun create failed"
    exit 1
fi

echo "hi!" >"$DIR/public/file.txt"
echo "export default 'string';" >"$DIR/file.js"

cd "$DIR"
BUN_CRASH_WITHOUT_JIT=1 $BUN_BIN dev --port 8087 &
sleep 0.1
curl --fail -Ss http://localhost:8087/

if [[ "$(curl --fail -sS http://localhost:8087/file.txt)" != "hi!" ]]; then
    echo ""
    echo ""
    echo ""
    echo "ERR: Expected 'hi!', got '$(curl --fail -sS http://localhost:8087/file.txt)'"
    killall -9 "$(basename "$BUN_BIN")" || echo ""
    exit 1
fi

if [[ "$(curl --fail -sS http://localhost:8087/file.js)" != *"string"* ]]; then
    echo ""
    echo ""
    echo ""
    echo "ERR: Expected file to contain string got '$(curl --fail -sS http://localhost:8087/file.js)'"
    killall -9 "$(basename "$BUN_BIN")" || echo ""
    exit 1
fi

# very simple HMR test
echo "export default 'string';" >"$DIR/file2.js"
sleep 0.1

if [[ "$(curl --fail -sS http://localhost:8087/file2.js)" != *"string"* ]]; then
    echo ""
    echo ""
    echo ""
    echo "ERR: Expected file to contain string got '$(curl --fail -sS http://localhost:8087/file2.js)'"
    killall -9 "$(basename "$BUN_BIN")" || echo ""
    exit 1
fi

killall -9 "$(basename "$BUN_BIN")" || echo ""
