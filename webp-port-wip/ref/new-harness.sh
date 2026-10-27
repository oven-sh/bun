#!/bin/bash
# usage: new-harness.sh <bun checkout or worktree>   -> creates <checkout>/target/webp-diff, a copy of the harness bound to that checkout's src/webp
set -e
W=$(realpath "$1")
[ -e "$W/vendor" ] || ln -s /root/repos/oven-sh/bun/vendor "$W/vendor"
mkdir -p "$W/target/webp-diff"
cp -r /root/ref/harness/src /root/ref/harness/build.rs "$W/target/webp-diff/"
sed "s|@WEBP@|$W/src/webp|" /root/ref/harness/Cargo.toml > "$W/target/webp-diff/Cargo.toml"
cp "$W/rust-toolchain.toml" "$W/target/webp-diff/"
echo "$W/target/webp-diff"
