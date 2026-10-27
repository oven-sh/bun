#!/bin/bash
# A second copy of the reference library whose global symbols start with c_, so that the harness can hold the SIMD and
# the plain C flavour in one process (each copy has its own VP8GetCPUInfo and dsp tables).
set -e
D=$(dirname "$(realpath "$0")")/refc
rm -rf "$D"
mkdir -p "$D"
llvm-nm-23 --defined-only --extern-only --format=just-symbols /root/ref/build/libwebp_ref.a 2>/dev/null \
  | grep -v ':$' | grep -v '^$' | sort -u | awk '{print $1 " c_" $1}' > "$D/syms.txt"
llvm-objcopy-23 --redefine-syms="$D/syms.txt" /root/ref/build/libwebp_ref.a "$D/libwebp_refc.a"
wc -l "$D/syms.txt"
ls -la "$D"
