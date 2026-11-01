#!/bin/sh
# Requests per second of the servers compiled ahead of time against the same sources under the JIT, and nothing else. See README.md.
# One core for a server, a closed loop of 64 connections, 200,000 requests of warm-up, one window of five seconds. No latency, no four cores.
#
#   against-the-jit-quick.sh <bun whose `build --compile` takes --aot> <bun to compile the JIT's column with> [<cores, default 0-15>] [<folder for the rows, default ./against-the-jit-quick>]
#   SERVERS=express,fastify ROUTES=text,json STARTS=1 MODULES=<an installed node_modules of ../app> narrow it down.
set -e
here=$(cd "$(dirname "$0")" && pwd)
aot=$1 jit=$2 cores=${3:-0-15} out=${4:-against-the-jit-quick}
[ -x "$aot" ] && [ -x "$jit" ] || { sed -n 2,6p "$0"; exit 2; }
mkdir -p "$out"
rm -f "$out/rows.jsonl"
python3 "$here/measure.py" --column "jit=$jit" --column "aot=$aot:--aot" --column "own=$aot" --servers "${SERVERS:-bun,hono,elysia,node,koa,tanstack,express,fastify}" \
  --routes "${ROUTES:-text,async,params,json,hand,typed,post,stream}" --cores "$cores" --starts "${STARTS:-3}" --rounds 1 --max-rounds 1 --window-seconds 5 --first-responses 1 --alive-requests 0 \
  ${MODULES:+--modules "$MODULES"} --out "$out/rows.jsonl" || echo "some rows failed: see above"
python3 "$here/against_the_jit_quick.py" "$out/rows.jsonl" | tee "$out/table.txt"
