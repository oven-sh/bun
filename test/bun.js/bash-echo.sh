#!/usr/bin/env bash

echoerr() { echo "$@" 1>&2; }

myvar=$(cat /dev/stdin)
# echoerr ${#myvar} chars
echo -e "$myvar"
