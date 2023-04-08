#!/bin/bash

if [ -z "$1" ]; then
  echo "Usage: $0 <test name> <use_esbuild>"
  echo "If you pass the second argument as anything, this will use esbuild instead of bun build."
  exit 1
fi

__dirname="$(dirname "$0")"
cd "$__dirname"

clear

printf "bun build test helper: $@"
printf "\n\n"

export BUN_BUNDLER_TEST_DEBUG=1
export BUN_BUNDLER_TEST_FILTER=$1
if [ -n "$2" ]; then
  export BUN_BUNDLER_TEST_USE_ESBUILD=1
fi

export FORCE_COLOR=1
bun test bundler_ esbuild/ 2>&1 \
  | perl -ne 'print unless /^\e\[0m$/' \
  | grep -v -P '\x1b\[0m\x1b\[33m-\x1b\[2m \x1b\[0m\x1b\[2mbundler' \
  | grep -v ".test.ts:$" \
  | tee /tmp/run-single-bundler-test.txt \
  | grep "root:" -v

symlinkDir=$(cat /tmp/run-single-bundler-test.txt | grep "root:" | cut -d " " -f 2)
rm /tmp/run-single-bundler-test.txt
rm $__dirname/out -rf
if [ -e "$symlinkDir" ]; then
  ln -s "$symlinkDir" $__dirname/out
fi
