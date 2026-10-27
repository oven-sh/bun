#!/bin/bash
# usage: asm.sh            lists bun_webp's functions in the perf binary with their size in instructions
#        asm.sh NAME [TOP] histogram of the instructions of the functions whose name contains NAME
#        asm.sh -d NAME    the disassembly itself
cd "$(dirname "$(realpath "$0")")"
objdump -d --no-show-raw-insn -M intel -C target/perf/webp-diff > target/perf.asm
if [ -z "$1" ]; then
  awk '/^[0-9a-f]+ <.*>:$/ {name=$0; sub(/^[0-9a-f]+ </,"",name); sub(/>:$/,"",name)} /^ / {n[name]++} END {for (k in n) if (k ~ /bun_webp/) print n[k], k}' target/perf.asm | sort -rn | head -40
elif [ "$1" = "-d" ]; then
  awk -v fn="$2" '/^[0-9a-f]+ <.*>:$/ {p = index($0, fn) > 0} p {print}' target/perf.asm
else
  awk -v fn="$1" '/^[0-9a-f]+ <.*>:$/ {p = index($0, fn) > 0; next} p && /^ / {print $2}' target/perf.asm | sort | uniq -c | sort -rn | head -${2:-25}
fi
