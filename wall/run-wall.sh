#!/bin/bash
# Interleaved A/B wall-time runs of the probes; 5 rounds; raw output per round in wall/<probe>-<build>-<round>.txt
cd /tmp/repro-9089/wall
for round in 1 2 3 4 5; do
  for build in base new; do
    B=/tmp/repro-9089/bin/bun-$build
    $B /tmp/final-9089/typical.js > typical-$build-$round.txt 2>&1
    $B /tmp/final-9089/mixed.js > mixed-$build-$round.txt 2>&1
    $B /tmp/probe-costbound/arrays.js > arrays-$build-$round.txt 2>&1
    (cd /tmp/probe-costbound/poll && $B test ./poll.test.js) > poll-$build-$round.txt 2>&1
  done
done
echo done > wall-done.flag
