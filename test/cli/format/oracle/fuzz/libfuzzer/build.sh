#!/bin/sh
# build.sh [asan | plain | coverage]: builds fuzz_format, fuzz_lint and fuzz_parser into
# $CARGO_TARGET_DIR/<mode> (default: target/fuzz/<mode> at the root of the repository).
#   asan      libFuzzer's instrumentation, AddressSanitizer, overflow checks, debug assertions
#   plain     the same without AddressSanitizer: twice as fast, and frames on the stack of the size they have in Bun
#   coverage  no fuzzing: -C instrument-coverage, to run a corpus and see what it reaches (coverage.sh)
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
RUSTFLAGS="$flags" cargo build --profile $profile --locked --target "$host"
out="$CARGO_TARGET_DIR/$host/$profile"
for language in html handlebars css yaml markdown md graphql json js; do
  ln -sf fuzz_format "$out/fuzz_$language"
done
echo "built: $out"
