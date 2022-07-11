#!/usr/bin/env bash

# TODO: move this test to bun once we have a child_process equivalent.

set -euo pipefail

(killall -9 "$(basename "$BUN_BIN")" || echo "") >/dev/null 2>&1

# https://github.com/oven-sh/bun/issues/40
# Define a function (details aren't important)
fn() { :; }
# The important bit: export the function
export -f fn

rm -rf /tmp/bun-run-check
mkdir -p /tmp/bun-run-check
DIR=/tmp/bun-run-check

cp ./bun-run-check-package.json "$DIR/package.json"
cp ./bun-run-check-nameless-package.json "$DIR/package.json"

cd "$DIR"

$BUN_BIN run bash -- -c ""

if (($?)); then
    echo "Bash exported functions are broken"
    exit 1
fi

# https://github.com/oven-sh/bun/issues/53
rm -f "$DIR/bun-run-out.expected.txt" "$DIR/bun-run-out.txt" >/dev/null 2>&1

$BUN_BIN run --silent argv -- foo bar baz >"$DIR/bun-run-out.txt"
npm run --silent argv -- foo bar baz >"$DIR/bun-run-out.expected.txt"

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

# Run it a second time with our other script which has no name

rm -rf /tmp/bun-run-check
mkdir -p /tmp/bun-run-check
DIR=/tmp/bun-run-check

cd "../"
cd "$DIR"

$BUN_BIN run bash -- -c ""

if (($?)); then
    echo "Bash exported functions are broken"
    exit 1
fi

# https://github.com/oven-sh/bun/issues/53
rm -f "$DIR/bun-run-out.expected.txt" "$DIR/bun-run-out.txt" >/dev/null 2>&1

$BUN_BIN run --silent argv -- foo bar baz >"$DIR/bun-run-out.txt"
npm run --silent argv -- foo bar baz >"$DIR/bun-run-out.expected.txt"

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
