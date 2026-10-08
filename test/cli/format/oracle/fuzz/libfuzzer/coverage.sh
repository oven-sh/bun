#!/bin/sh
# coverage.sh <binaries of build.sh coverage> <work> <target> <part of the paths to report, e.g. src/format/html>:
# runs <work>/corpus/<target>, and prints how much of each file is reached, and the functions that are never reached.
set -e
binaries=$1 work=$2 target=$3 part=$4
tools=$(rustc --print sysroot)/lib/rustlib/$(rustc -vV | sed -n 's/^host: //p')/bin
ulimit -c 0
ulimit -s 4096
mkdir -p "$work/coverage"
rm -f "$work/coverage/$target"-*.profraw
export FUZZ_FINDINGS="$work/coverage/findings"
# It says that nothing is instrumented, which is true of libFuzzer's own instrumentation, and exits with 1.
LLVM_PROFILE_FILE="$work/coverage/$target-%p.profraw" "$binaries/fuzz_$target" -runs=0 -timeout=20 -rss_limit_mb=4096 "$work/corpus/$target" > /dev/null 2>&1 || true
"$tools/llvm-profdata" merge -sparse "$work/coverage/$target"-*.profraw -o "$work/coverage/$target.profdata"
rm -f "$work/coverage/$target"-*.profraw
case $target in
  lint | parser) binary=fuzz_$target ;;
  *) binary=fuzz_format ;;
esac
"$tools/llvm-cov" report "$binaries/$binary" -instr-profile="$work/coverage/$target.profdata" --ignore-filename-regex='/\.cargo/|/rustc/' 2> /dev/null | grep -E "^Filename|$part|^TOTAL" | sed -E 's/ +/ /g'
echo "---- never reached"
"$tools/llvm-cov" report "$binaries/$binary" -instr-profile="$work/coverage/$target.profdata" -show-functions $(cd "$(dirname "$0")/../../../../../.." && find "$PWD/$part" -name '*.rs') 2> /dev/null | awk '$1 ~ /^File/ { file = $2 } NF >= 7 && $4 == "0.00%" { print file, $1 }' | rustfilt 2> /dev/null || true
