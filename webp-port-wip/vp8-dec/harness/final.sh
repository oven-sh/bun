#!/bin/bash
# The final verification. The binary is built first and copied, so later edits to the checkout do not matter.
set -e
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$(realpath "$0")")"
cargo build --release 2>&1 | grep -E "^(error|warning)" -A12 || true
cp target/release/webp-diff target/webp-diff-final
echo BUILT
export WEBP_DIFF_KEEP=../webp-work/fail-final WEBP_DIFF_STUB_ALPHA=1
WEBP_DIFF_FILTER=-vp8 ./target/webp-diff-final dec /root/ref/corpus/dec | tail -2
./target/webp-diff-final dec ../webp-work/bench ../webp-work/bench2 | tail -2
for seed in 101 102 103 104; do
  ./target/webp-diff-final mutate ../webp-work/lossy 600000 $seed 30 | grep -v NOTE | tail -3
done
for seed in 201 202; do
  ./target/webp-diff-final craft ../webp-work/lossy 500000 $seed 30 | grep -v NOTE | tail -3
done
echo DONE
