#!/bin/sh
# run.sh <binaries> <work> <target> [seconds] [jobs] [largest input]: fuzzes one target.
#   <binaries>  where build.sh has put them
#   <work>      corpus/<target>, findings/<target>, artifacts/<target> and logs/<target> are made there. Put the output of
#               seeds.ts at <work>/seeds.
#   <target>    options imports embedded html handlebars css yaml markdown md graphql json js lint parser
# What a target notices by itself (a panic, an alarm of the formatter's own checks, output that does not stay as it is, ..)
# goes to findings/, the smallest input for each, and the fuzzer goes on. What ends the process (a stack overflow, a report
# of AddressSanitizer, a timeout, too much memory) goes to artifacts/.
set -e
here=$(cd "$(dirname "$0")" && pwd)
binaries=$1 work=$2 target=$3 seconds=${4:-600} jobs=${5:-4} largest=${6:-4096}
case $target in
  lint | parser | imports) dictionary=js ;;
  options) dictionary=options ;;
  md) dictionary=markdown ;;
  *) dictionary=$target ;;
esac
mkdir -p "$work/corpus/$target" "$work/findings" "$work/artifacts/$target" "$work/logs/$target"
ulimit -c 0
# The stack of a thread of Bun's pool, which is what formats and lints. FUZZ_STACK_KB=1024, with the build that has AddressSanitizer,
# which is what reports a stack overflow: a recursion that nothing checks shows on inputs of a few thousand bytes.
ulimit -s "${FUZZ_STACK_KB:-4096}"
export FUZZ_FINDINGS="$work/findings"
export ASAN_OPTIONS=detect_stack_use_after_return=0:allocator_may_return_null=1:detect_leaks=${LEAKS:-0}:symbolize=1
cd "$work/logs/$target"
seeds=
[ -d "$work/seeds/$target" ] && seeds="$work/seeds/$target"
[ -d "$here/found/$target" ] && seeds="$seeds $here/found/$target"
exec "$binaries/fuzz_$target" "$work/corpus/$target" $seeds \
  -dict="$here/dictionaries/$dictionary.dict" -artifact_prefix="$work/artifacts/$target/" \
  -max_len="$largest" -timeout=5 -rss_limit_mb=2048 -malloc_limit_mb=1024 -max_total_time="$seconds" \
  -fork="$jobs" -ignore_crashes=1 -ignore_timeouts=1 -ignore_ooms=1 -print_final_stats=1 -use_value_profile=0
