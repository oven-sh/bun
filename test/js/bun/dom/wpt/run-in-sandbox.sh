#!/bin/bash
# Runs run-directory.js in a container with no network, an unprivileged user and read-only mounts, then prints a summary.
#
#   run-in-sandbox.sh <bun binary> <wpt directory> <results.jsonl.gz> [--jobs=N] [--timeout-multiplier=N] <directory or test>...
#
# DOCKER_ARGUMENTS adds to the container's, for example a mount that puts a changed copy over one test.
set -euo pipefail

bun=$(realpath "$1")
wpt=$(realpath "$2")
results=$3
shift 3
harness=$(dirname "$(realpath "$0")")

docker run --rm --network none --user 65534:65534 --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -e HOME=/tmp -e BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 -e BUN_ENABLE_CRASH_REPORTING=0 -e NO_COLOR=1 \
  -v "$bun":/bun/bun:ro -v "$wpt":/wpt:ro -v "$harness":/harness:ro -w /tmp ${DOCKER_ARGUMENTS:-} \
  mcr.microsoft.com/playwright:v1.64.0-noble \
  /bun/bun /harness/run-directory.js /wpt "$@" | gzip > "$results"

"$bun" "$harness/summarize.js" "$results"
