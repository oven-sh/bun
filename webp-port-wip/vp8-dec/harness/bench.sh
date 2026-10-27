#!/bin/bash
# Builds the perf profile and times every benchmark file. usage: [STAGES=1] bench.sh [N] [FILTER]
set -e
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$(realpath "$0")")"
RUSTFLAGS="-Ctarget-cpu=nehalem" cargo build --profile perf ${STAGES:+--features stages} 2>&1 | grep -E "^(error|warning)" -A12 || true
for f in ../webp-work/bench/*${2:-}*.webp; do
  printf "%-28s" "$(basename "$f")"
  ./target/perf/webp-diff bench-dec "$f" "${1:-10}"
done
