#!/bin/sh
# coverage.sh <binaries of build.sh coverage> <work> <target> <part of the paths to report, e.g. src/format/html>:
# runs <work>/corpus/<target>, and prints how much of each file is reached, and the functions that are never reached.
set -e
binaries=$1 work=$2 target=$3 part=$4
tools=$(rustc --print sysroot)/lib/rustlib/$(rustc -vV | sed -n 's/^host: //p')/bin
ulimit -c 0
ulimit -s 4096
mkdir -p "$work/coverage"
export FUZZ_FINDINGS="$work/coverage/findings"
# KEEP=1: the counts of the run before are reported again, for another part of the paths.
if [ -z "$KEEP" ] || [ ! -f "$work/coverage/$target.profdata" ]; then
  rm -f "$work/coverage/$target"-*.profraw
  # It says that nothing is instrumented, which is true of libFuzzer's own instrumentation, and exits with 1.
  LLVM_PROFILE_FILE="$work/coverage/$target-%p.profraw" "$binaries/fuzz_$target" -runs=0 -timeout=20 -rss_limit_mb=4096 "$work/corpus/$target" > /dev/null 2>&1 || true
  "$tools/llvm-profdata" merge -sparse "$work/coverage/$target"-*.profraw -o "$work/coverage/$target.profdata"
  rm -f "$work/coverage/$target"-*.profraw
fi
case $target in
  lint | parser) binary=fuzz_$target ;;
  *) binary=fuzz_format ;;
esac
"$tools/llvm-cov" export "$binaries/$binary" -instr-profile="$work/coverage/$target.profdata" -skip-expansions -skip-branches 2> /dev/null > "$work/coverage/$target.json"
PART=$part bun -e '
const { files, functions } = (await Bun.file(process.argv[1]).json()).data[0];
const part = process.env.PART;
let [lines, covered] = [0, 0];
for (const { filename, summary } of files) {
  if (!filename.includes(part)) continue;
  lines += summary.lines.count;
  covered += summary.lines.covered;
  console.log(`${summary.lines.percent.toFixed(1).padStart(5)} % of ${String(summary.lines.count).padStart(5)} lines, ${summary.functions.count - summary.functions.covered} of ${summary.functions.count} functions never reached  ${filename.slice(filename.indexOf(part))}`);
}
console.log(`${((100 * covered) / lines).toFixed(1)} % of ${lines} lines in ${part}`);
console.log("---- never reached");
// A generic function is there once for each use.
const reached = new Map();
for (const { name, count, filenames } of functions) {
  if (!filenames[0].includes(part)) continue;
  const key = filenames[0].slice(filenames[0].indexOf(part)) + " " + name.replace(/^.*:/, "");
  reached.set(key, (reached.get(key) ?? 0) + count);
}
console.log([...reached].filter(([, count]) => count == 0).map(([key]) => key).sort().join("\n"));
' "$work/coverage/$target.json" | rustfilt
rm -f "$work/coverage/$target.json"
