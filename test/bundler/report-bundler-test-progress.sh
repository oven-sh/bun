#!/bin/bash

tests="$(echo esbuild/* bundler*.test.ts)"

printf "%40s %7s %7s | %5s %5s %5s\n" "TEST" "defined" "refined" "pass" "fail" "skip"

total_defined=0
total_total=0
total_pass=0
total_fail=0
total_skip=0

for test in $tests; do
  defined=$(grep -Ec "expectBundled|itBundled" $test)
  defined=$((defined - 1))
  output=$(bun test $test 2>&1 | tail -n 5)
  pass=$(echo "$output" | grep "pass" | cut -d " " -f 2)
  fail=$(echo "$output" | grep "fail" | cut -d " " -f 2)
  skip=$(echo "$output" | grep "skip" | cut -d " " -f 2)
  if [ -z "$skip" ]; then skip=0; fi
  if [ -z "$fail" ]; then fail=0; fi
  if [ -z "$pass" ]; then pass=0; fi
  total=$((pass + fail + skip))
  printf "%40s %7s %7s | %5s %5s %5s\n" "$test" "$defined" "$total" "$pass" "$fail" "$skip"

  total_defined=$((total_defined + defined))
  total_total=$((total_total + total))
  total_pass=$((total_pass + pass))
  total_fail=$((total_fail + fail))
  total_skip=$((total_skip + skip))
done

printf -- "\n"
printf "%40s %7s %7s | %5s %5s %5s\n" "TOTAL" "$total_defined" "$total_total" "$total_pass" "$total_fail" "$total_skip"
printf "\n"
printf "\n"
printf "  %s%% Refined\n" $(echo "scale=1; $total_total / $total_defined * 100" | bc)
printf "  %s%% Passing\n" $(echo "scale=1; $total_pass / $total_total * 100" | bc)
printf "  %s%% Passing including what we skip\n" $(echo "scale=1; $total_pass / $total_total * 100" | bc)
