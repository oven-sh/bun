#!/bin/bash
# Large lossy files for bench-dec, from the shared pixel sources.
set -e
cd "$(dirname "$(realpath "$0")")"
mkdir -p ../webp-work/bench
for f in cat-1194 person-large-1000 buntest-2112 lambda4-3116; do
  for q in 75 95; do
    ./target/release/webp-diff enc /root/ref/corpus/img/$f.webp ../webp-work/bench/$f-q$q.webp $q
  done
done
ls -la ../webp-work/bench
