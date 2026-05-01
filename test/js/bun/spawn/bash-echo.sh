#!/usr/bin/env bash
# On Linux/Cygwin, $(</dev/stdin) doesn't work when stdin is a socket.
myvar=$(cat)
echo -e "$myvar"
