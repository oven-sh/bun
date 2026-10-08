#!/bin/sh
# show.sh <binaries> <target> <input>: what an input is (the name of the file, the flags, the text) and what becomes of it.
# A finding ends the process, and says what it is. FUZZ_ONLY=<kind>/<key>: only that one does.
ulimit -c 0
ulimit -s 4096
export ASAN_OPTIONS=detect_stack_use_after_return=0:allocator_may_return_null=1:detect_leaks=0:symbolize=1
FUZZ_SHOW=1 exec "$1/fuzz_$2" -timeout=20 -rss_limit_mb=4096 "$3"
