#!/bin/sh
# RUSTC_WRAPPER for build.sh. The flags of a package in a profile of Cargo.toml go to its build script too, which is not linked with libFuzzer: for a
# package that has one, this gives them to the library alone. INSTRUMENT: the flags.
for argument in "$@"; do
  case $previous in
    --crate-name) [ "$argument" = bun_parsers ] && exec "$@" $INSTRUMENT ;;
  esac
  previous=$argument
done
exec "$@"
