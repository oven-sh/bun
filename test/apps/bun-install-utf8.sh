#!/usr/bin/env bash

set -euo pipefail

killall -9 $(basename $BUN_BIN) || echo ""

dir=$(mktemp -d)

cd $dir

# https://github.com/oven-sh/bun/issues/115
echo '{ "author": "Arnaud Barré (https://github.com/ArnaudBarre)" }' >package.json

$BUN_BIN add react
