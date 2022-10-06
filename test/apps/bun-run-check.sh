#!/usr/bin/env bash

# TODO: move this test to bun once we have a child_process equivalent.
(killall -9 $(basename $BUN_BIN) || echo "") >/dev/null 2>&1

# https://github.com/oven-sh/bun/issues/40
# Define a function (details aren't important)
fn() { :; }
# The important bit: export the function
export -f fn

rm -rf /tmp/bun-run-check
mkdir -p /tmp/bun-run-check

cp ./bun-run-check-package.json /tmp/bun-run-check/package.json
cd /tmp/bun-run-check

$BUN_BIN run bash -- -c ""

if (($?)); then
    echo "Bash exported functions are broken"
    exit 1
fi

# We need to run these tests for two variations:
# bun run foo "bar"
# bun run foo -- "bar"
# the "--" should be ignored
# in earlier versions of bun, it was required to be present

$BUN_BIN run bash -c ""
if (($?)); then
    echo "Bash exported functions are broken"
    exit 1
fi

# https://github.com/oven-sh/bun/issues/53
rm -f /tmp/bun-run-out.expected.txt /tmp/bun-run-out.txt >/dev/null 2>&1

$BUN_BIN run --silent argv -- foo bar baz >/tmp/bun-run-out.txt
npm run --silent argv -- foo bar baz >/tmp/bun-run-out.expected.txt

cmp -s /tmp/bun-run-out.expected.txt /tmp/bun-run-out.txt
if (($?)); then
    echo "argv failed"
    exit 1
fi

rm -f /tmp/bun-run-out.expected.txt /tmp/bun-run-out.txt >/dev/null 2>&1

$BUN_BIN run --silent argv foo bar baz >/tmp/bun-run-out.txt
npm run --silent argv -- foo bar baz >/tmp/bun-run-out.expected.txt

cmp -s /tmp/bun-run-out.expected.txt /tmp/bun-run-out.txt
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
