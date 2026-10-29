#!/bin/sh
# Servers compiled ahead of time against the same sources under the JIT, in one command. See README.md.
# Three columns: compiled with --aot | the second Bun's JIT | the first Bun's own JIT (the same runtime, modules and native code as the compiled column).
#
#   against-the-jit.sh <bun whose `build --compile` takes --aot> <bun to compile the JIT's column with> [<cores, default 0-15>] [<folder for the rows, default ./against-the-jit>]
#   SERVERS=express,fastify ROUTES=text,json STARTS=1 MODULES=<an installed node_modules of ../app> narrow it down. QUICK=1: one start and shorter windows: an hour.
set -e
here=$(cd "$(dirname "$0")" && pwd)
aot=$1 jit=$2 cores=${3:-0-15} out=${4:-against-the-jit}
[ -x "$aot" ] && [ -x "$jit" ] || { sed -n 2,6p "$0"; exit 2; }
mkdir -p "$out"
rm -f "$out/one-core.jsonl" "$out/four-cores.jsonl"
servers=${SERVERS:-bun,hono,elysia,node,koa,tanstack,express,fastify,fastify-schemas}
routes=${ROUTES:-text,async,params,json,hand,typed,post,stream}
# The name of the event differs by processor, and a name that perf takes may still count nothing.
misses=
for event in ic_tag_hit_miss.instruction_cache_miss L1-icache-load-misses; do
  case $(perf stat -x, -e "$event:u" -- "$jit" --version 2>&1 > /dev/null | tail -n 1 | cut -d, -f1) in
    '' | 0 | *[!0-9]*) ;;
    *) misses=$event, && break ;;
  esac
done
measure() { python3 "$here/measure.py" --column "jit=$jit" --column "aot=$aot:--aot" --column "own=$aot" --servers "$servers" --routes "$routes" --cores "$cores" --rate 0.5 --events "${misses}branch-misses" --alive-requests 0 --starts "${STARTS:-2}" ${QUICK:+--starts 1 --rounds 2 --max-rounds 2 --window-seconds 1} ${MODULES:+--modules "$MODULES"} "$@"; }
measure --out "$out/one-core.jsonl" || echo "some rows of one core failed: see above"
measure --server-cores 4 --out "$out/four-cores.jsonl" || echo "some rows of four cores failed: see above"
python3 "$here/against_the_jit.py" "$out/one-core.jsonl" "$out/four-cores.jsonl" --other own | tee "$out/table.md"
