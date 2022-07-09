#!/bin/bash

set -euo pipefail

(killall -9 "$(basename "$BUN_BIN")" || echo "") >/dev/null 2>&1

# https://github.com/Jarred-Sumner/bun/issues/40
# Define a function (details aren't important)
fn() { :; }
# The important bit: export the function
export -f fn

DIR=$(mktemp -d -t bun-run-check)

cp ./bun-run-check-package.json "$DIR/package.json"
cd "$DIR"

$BUN_BIN run bash -- -c ""

if (($?)); then
    echo "Bash exported functions are broken"
    exit 1
fi

# https://github.com/Jarred-Sumner/bun/issues/53
rm -f "$DIR/bun-run-out.expected.txt" "$DIR/bun-run-out.txt" >/dev/null 2>&1

$BUN_BIN run --silent argv -- foo bar baz > "$DIR/bun-run-out.txt"
npm run --silent argv -- foo bar baz > "$DIR/bun-run-out.expected.txt"

cmp -s "$DIR/bun-run-out.expected.txt" "$DIR/bun-run-out.txt"
if (($?)); then
    echo "argv failed"
    exit 1
fi

$BUN_BIN run --silent this-should-work

if (($?)); then
    echo "this-should work failed"
    exit 1
fi

exit 0
