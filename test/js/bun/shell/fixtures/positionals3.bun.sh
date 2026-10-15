#!/bin/sh

echo ${1} ${10} $10
echo ${2:-x} ${12:-none} ${12:+some}
