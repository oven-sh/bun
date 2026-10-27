#!/bin/bash
# Builds the reference libwebp v1.6.0 the way Bun's scripts/build/deps/libwebp.ts did.
set -e
SRC=/root/ref/libwebp
OUT=/root/ref/cov/obj
mkdir -p $OUT
cd $SRC
files=$(ls src/dec/*.c src/enc/*.c src/dsp/*.c src/utils/*.c src/demux/demux.c src/mux/muxedit.c src/mux/muxinternal.c src/mux/muxread.c sharpyuv/*.c)
for f in $files; do
  flag=""
  case $f in
    *_avx2.c) flag=-mavx2;;
    *_sse41.c) flag=-msse4.1;;
    *_sse2.c) flag=-msse2;;
  esac
  o=$OUT/$(echo $f | tr / _).o
  echo "clang-23 -O1 -g -fPIC -fsanitize-coverage=trace-pc-guard $flag -I. -Isrc -c $f -o $o"
done | xargs -P 32 -I{} sh -c "{}"
clang-23 -O1 -g -fPIC -fsanitize-coverage=trace-pc-guard -I. -Isrc -c /root/ref/build/shim.c -o $OUT/shim.o
clang-23 -O2 -fPIC -c /root/ref/cov/cov.c -o $OUT/cov.o
rm -f /root/ref/cov/libwebp_ref.a
llvm-ar-23 rcs /root/ref/cov/libwebp_ref.a $OUT/*.o
