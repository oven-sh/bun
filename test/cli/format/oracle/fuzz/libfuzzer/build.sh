#!/bin/sh
# build.sh [asan | plain | coverage]: builds fuzz_format, fuzz_lint, fuzz_parser, fuzz_config, fuzz_regex and fuzz_glob into
# $CARGO_TARGET_DIR/<mode> (default: target/fuzz/<mode> at the root of the repository).
#   asan      libFuzzer's instrumentation, AddressSanitizer, overflow checks, debug assertions
#   plain     the same without AddressSanitizer: twice as fast, and frames on the stack of the size they have in Bun
#   coverage  no fuzzing: -C instrument-coverage, to run a corpus and see what it reaches (coverage.sh)
# KERNELS=<directory>: every *.o in it is linked too: Bun's SIMD kernels (src/jsc/bindings/highway_*.cpp and vendor/highway/hwy/targets.cc, compiled
# as Bun compiles them, with -fsanitize=address for asan). They take the place of the plain loops in src/sema/standalone/native.rs, which are weak symbols.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../../../.." && pwd)
mode=${1:-asan}
host=$(rustc -vV | sed -n 's/^host: //p')
flags="--cap-lints warn --cfg fuzzing --cfg bun_sema_mimalloc -Clink-arg=-fuse-ld=lld -A linker_messages"
profile=fuzz
case $mode in
  asan) flags="$flags -Zsanitizer=address --cfg bun_asan" ;;
  plain) ;;
  coverage) profile=coverage ;;
  *) echo "usage: build.sh [asan | plain | coverage]"; exit 2 ;;
esac
triple=$(echo "$host" | tr 'a-z-' 'A-Z_')
export "CARGO_TARGET_${triple}_LINKER=${CXX:-clang++}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$root/target/fuzz}/$mode"
cd "$here"
if [ -n "$KERNELS" ]; then
  # Only the programs are linked again.
  objects=
  for object in "$KERNELS"/*.o; do objects="$objects -Clink-arg=$object"; done
  for program in fuzz_format fuzz_lint fuzz_parser fuzz_config fuzz_regex fuzz_glob; do
    RUSTFLAGS="$flags" cargo rustc --profile $profile --target "$host" --bin $program -- $objects -Clink-arg=-lstdc++
  done
else
  RUSTFLAGS="$flags" cargo build --profile $profile --target "$host"
fi
out="$CARGO_TARGET_DIR/$host/$profile"
for language in options imports embedded html handlebars css yaml markdown md graphql json js; do
  ln -sf fuzz_format "$out/fuzz_$language"
done
echo "built: $out"
