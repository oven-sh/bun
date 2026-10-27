#!/bin/bash
# usage: profile.sh FILE [lines]    where bun_webp spends its time decoding FILE (a name in ../webp-work/bench)
set -e
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$(realpath "$0")")"
RUSTFLAGS="-Ctarget-cpu=nehalem" cargo build --profile perf ${STAGES:+--features stages} 2>&1 | grep -E "^(error|warning)" -A12 || true
./target/perf/webp-diff profile "../webp-work/bench/$1.webp" ${N:-1500} target/samples.txt
python3 -I profile.py target/perf/webp-diff target/samples.txt $2
