#!/usr/bin/env bash

# TODO: move this test to bun once we have a child_process equivalent.
(killall -9 $(basename $BUN_BIN) || echo "") >/dev/null 2>&1

rm -rf /tmp/bun-init-check
mkdir -p /tmp/bun-init-check

cd /tmp/bun-init-check

$BUN_BIN init -y

if (($?)); then
    echo "Bun init failed"
    exit 1
fi

SHASUM_RESULT=$(cat index.ts .gitignore tsconfig.json package.json | shasum)

# This test will fail when the minor version of Bun changes.
if [[ "${SHASUM_RESULT}" != "10eabf5101a3ef999bd67232a7af33542c525ec6  -" ]]; then
    echo -e "Bun init shasum mismatch\n  expected: b1548bb4e806f0506fd1b27ae8901d2e84926774\n  actual: ${SHASUM_RESULT}"
    exit 1
fi

exit 0
