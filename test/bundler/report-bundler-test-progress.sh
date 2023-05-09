#!/bin/bash

tests="$(echo esbuild/* bundler*.test.ts)"

printf "%40s %7s %7s | %5s %5s %5s | %5s\n" "TEST" "defined" "refined" "pass" "fail" "skip" "%pass"

total_defined=0
total_total=0
total_pass=0
total_fail=0
total_skip=0

for test in $tests; do
  defined=$(grep "^import" $test -v | grep -v expectBundled.md | grep -Ec "expectBundled|itBundled")
  output=$(BUN_BUNDLER_TEST_LOOSE=false BUN_BUNDLER_TEST_NO_CHECK_SKIPPED=true bun test $test 2>&1 | tail -n 5)
  pass=$(echo "$output" | grep "pass" | cut -d " " -f 2)
  fail=$(echo "$output" | grep "fail" | cut -d " " -f 2)
  skip=$(echo "$output" | grep "skip" | cut -d " " -f 2)
  if [ -z "$skip" ]; then skip=0; fi
  if [ -z "$fail" ]; then fail=0; fi
  if [ -z "$pass" ]; then pass=0; fi
  total=$((pass + fail + skip))
  percent_pass=$(echo "scale=1; ($pass * 100) / ($pass + $fail) " | bc 2>/dev/null || echo "-")
  printf "%40s %7s %7s | %5s %5s %5s | %5s%%\n" "$test" "$defined" "$total" "$pass" "$fail" "$skip" "$percent_pass"

  total_defined=$((total_defined + defined))
  total_total=$((total_total + total))
  total_pass=$((total_pass + pass))
  total_fail=$((total_fail + fail))
  total_skip=$((total_skip + skip))
done

total_pass_percent=$(echo "scale=1; ($total_pass * 100) / ($total_pass + $total_fail)")

printf -- "\n"
printf "%40s %7s %7s | %5s %5s %5s | %5s\n" "TOTAL" "$total_defined" "$total_total" "$total_pass" "$total_fail" "$total_skip" "$total_pass_percent"
printf "\n"
printf "\n"
printf "  %s%% Refined\n" $(echo "scale=1; $total_total / $total_defined * 100" | bc)
printf "  %s%% Passing\n" $(echo "scale=1; $total_pass / $total_total * 100" | bc)
printf "  %s%% Passing including what we skip\n" $(echo "scale=1; $total_pass / $total_total * 100" | bc)
printf "\n"
printf "dave's status: %s/%s tests\n" $total_total $total_defined
