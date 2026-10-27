#!/bin/bash
# Builds the checked profile and runs the quick differential tests. usage: check.sh [ITERS] [SEED]
set -e
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$(realpath "$0")")"
cargo build --release 2>&1 | grep -E "^(error|warning)" -A12 || true
export WEBP_DIFF_KEEP=../webp-work/fail
N=${1:-100000}
S=${2:-1}
WEBP_DIFF_FILTER=-vp8 ./target/release/webp-diff dec /root/ref/corpus/dec | tail -3
./target/release/webp-diff mutate ../webp-work/lossy "$N" "$S" 16 | grep -v NOTE | tail -12
./target/release/webp-diff craft ../webp-work/lossy "$N" "$S" 16 | grep -v NOTE | tail -12
