#!/bin/bash
# Variants of the q75 benchmark files without loop filter and with the simple one.
set -e
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$(realpath "$0")")"
cargo build --release 2>&1 | grep -E "^(error|warning)" -A12 || true
mkdir -p ../webp-work/bench2
for f in cat-1194 person-large-1000 buntest-2112 lambda4-3116; do
  ./target/release/webp-diff refilter ../webp-work/bench/$f-q75.webp ../webp-work/bench2/$f-q75-off.webp off
  ./target/release/webp-diff refilter ../webp-work/bench/$f-q75.webp ../webp-work/bench2/$f-q75-simple.webp simple
done
./target/release/webp-diff dec ../webp-work/bench ../webp-work/bench2
for f in ../webp-work/bench2/*.webp; do
  printf "%-36s" "$(basename "$f")"
  ./target/perf/webp-diff bench-dec "$f" 10
done
