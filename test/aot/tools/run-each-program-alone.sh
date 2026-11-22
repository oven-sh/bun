#!/bin/bash
# run-each-alone.sh <folder of programs> <bun-profile> <label> (FLAGS=--aot-testing=CheckProofsAtRunTime for the proofs): each program built alone with --aot against what the SAME binary prints as plain Bun. One line a program.
D=$1; B=$2; L=$3; W=$(mktemp -d -p /dev/shm below.XXXXXX); cd $D
one() { f=$1; B=$2; W=$3; n=${f%.*}-${f##*.}; x=${f##*.}; mkdir -p $W/$n; cp $f $W/$n/a.$x; cd $W/$n
  want=$(timeout 30 $B run a.$x 2>&1)
  if ! timeout 300 $B build --compile --aot $FLAGS a.$x --outfile a > build.txt 2>&1; then echo "build-stops $f $(grep -a -m1 -i "error\|stop" build.txt | cut -c1-120)"; return; fi
  got=$(BUN_ENABLE_CRASH_REPORTING=0 timeout 30 ./a 2>&1); r=$?
  if [ "$want" = "$got" ]; then echo "same $f"; elif [ $r -ge 128 ]; then echo "crash $f exit=$r first=$(diff <(echo "$want") <(echo "$got") | grep -a -m1 "^<" | cut -c1-60)"; else echo "wrong $f exit=$r $(diff <(echo "$want") <(echo "$got") | grep -a -m2 "^[<>]" | tr "\n" "|" | cut -c1-150)"; fi
  rm -rf $W/$n; }
export -f one
ls | xargs -P 110 -I{} bash -c "one {} $B $W" > /dev/shm/below-$L.txt 2>&1
rm -rf $W
echo "$L: $(cut -d" " -f1 /dev/shm/below-$L.txt | sort | uniq -c | tr "\n" " ")"
