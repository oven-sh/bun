#!/bin/bash
# Runs run-in-browsers.js in the same kind of container as run-in-sandbox.sh.
#
#   run-browsers-in-sandbox.sh <playwright-core directory> <wpt directory> <results.jsonl> [--jobs=N] [--browsers=a,b] <directory or test>...
set -euo pipefail

playwright=$(realpath "$1")
wpt=$(realpath "$2")
results=$3
shift 3
harness=$(dirname "$(realpath "$0")")

docker run --rm --network none --user 65534:65534 --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --shm-size 1g \
  -e HOME=/tmp \
  -v "$playwright":/playwright-core:ro -v "$wpt":/wpt:ro -v "$harness":/harness:ro -w /tmp \
  mcr.microsoft.com/playwright:v1.64.0-noble \
  node /harness/run-in-browsers.js /playwright-core /wpt "$@" > "$results"
