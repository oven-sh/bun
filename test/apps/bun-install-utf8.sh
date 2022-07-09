#!/bin/bash

set -euo pipefail

killall -9 "$(basename "$BUN_BIN")" || echo ""

DIR=$(mktemp -d -t bun-ADD)

cd "$DIR"

# https://github.com/Jarred-Sumner/bun/issues/115
echo '{ "author": "Arnaud Barré (https://github.com/ArnaudBarre)" }' >package.json

$BUN_BIN add react
