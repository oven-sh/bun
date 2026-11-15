#!/bin/bash
# false-proofs-at-typed-stores.sh <folder with bun-profile> <folder of programs> <file for the lines> [jobs]
# Builds and runs each program by itself, with the fault injected (LIE=1: --aot-testing=..,AssumeUnknownCallsReturnUndefined) or without it.
# The configuration comes from the environment (ARM="NAME=value .."; WORD=<testing switches of the configuration>).
# The line for each program says one of:
# right (as plain Bun) | STOPPED BY A TRAP (SIGILL | SIGTRAP | SIGABRT, nothing wrong printed before it) | WRONG | CRASHED (SIGSEGV | SIGBUS) | does not build | killed by the clock.
A=$1; D=$2; OUT=$3; J=${4:-8}; W=$(mktemp -d /dev/shm/owst-door.XXXX); export NO_COLOR=1 BUN_ENABLE_CRASH_REPORTING=0 DO_NOT_TRACK=1 A W ARM WORD LIE
one() { p=$1; n=$(basename $p .ts); d=$W/$n; mkdir -p $d; cd $d; cp $p x.ts
  words=$WORD; [ -n "$LIE" ] && words=${words:+$words,}AssumeUnknownCallsReturnUndefined
  timeout 30 $A/bun-profile x.ts > plain.txt 2>&1; pe=$?
  if ! env $ARM timeout 120 $A/bun-profile build --compile --aot ${words:+--aot-testing=$words} x.ts --outfile x > b.log 2>&1; then echo "$n | does not build | $(grep -a -m1 "error\|AOT:" b.log | cut -c1-90)"; cd /; rm -rf $d; return; fi
  timeout 30 ./x > aot.txt 2> err.txt; e=$?
  if [ $pe = 124 ] || [ $e = 124 ]; then r="killed by the clock"; elif [ $e = 132 ] || [ $e = 133 ] || [ $e = 134 ]; then r="STOPPED BY A TRAP ($e)"; elif [ $e = 139 ] || [ $e = 135 ]; then r="CRASHED ($e)"; elif cmp -s plain.txt aot.txt; then r="right"; else r="WRONG (exit $e): $(head -c 70 aot.txt | tr "\n" " ") / plain: $(head -c 50 plain.txt | tr "\n" " ")"; fi
  echo "$n | $r"; cd /; rm -rf $d; }
export -f one; ls $D/*.ts | xargs -P $J -I{} bash -c 'one {}' | sort > $OUT
echo "$(basename $A) [${LIE:+the lie . }${ARM:-as built}]: right $(grep -c "| right" $OUT) . STOPPED BY A TRAP $(grep -c "STOPPED" $OUT) . WRONG $(grep -c "| WRONG" $OUT) . CRASHED $(grep -c "| CRASHED" $OUT) . does not build $(grep -c "does not build" $OUT) . killed $(grep -c "killed by" $OUT) . of $(wc -l < $OUT)"
rm -rf $W
