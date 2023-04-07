#!/bin/bash
rm __snapshots__ -rf
clear
printf "bun build test helper cli: $@"
printf "\n\n"
export BUN_BUNDLER_TEST_DEBUG=1
if [ -n "$1" ]; then
  export BUN_BUNDLER_TEST_FILTER=$1
fi
if [ -n "$2" ]; then
export BUN_BUNDLER_TEST_USE_ESBUILD=1
fi
cd $(dirname $0)
export FORCE_COLOR=1
bun test 2>&1 | perl -ne 'print unless /^\e\[0m$/' | grep -v -P '\x1b\[0m\x1b\[33m-\x1b\[2m \x1b\[0m\x1b\[2mbundler' | grep -v ".test.ts:$"
