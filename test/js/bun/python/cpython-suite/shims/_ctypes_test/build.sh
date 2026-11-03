#!/bin/sh
# Builds the library that _ctypes_test.py stands in front of. $1: CPython's sources.
set -e
here=$(cd "$(dirname "$0")" && pwd)
${CC:-cc} -shared -fPIC -O1 -w -I"$here/src" -I"$1/Modules/_ctypes" "$1/Modules/_ctypes/_ctypes_test.c" -lm -o "$here/_ctypes_test_library.so"
