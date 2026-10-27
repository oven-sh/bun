#!/bin/bash
# usage: new-harness.sh <bun checkout>
# Copies <checkout>/src/webp to /root/ref/crate as a crate of its own (no Bun workspace, no vendor/ needed), with a
# dev_hooks module that exports a few internals, and sets up every harness variant under /root/ref/h/<name>.
# Run it again after each pull: it only refreshes the crate copy and leaves existing harness directories alone.
set -e
W=$(realpath "$1")
rm -rf /root/ref/crate && mkdir -p /root/ref/crate
cp -r "$W/src/webp" /root/ref/crate/src
rm -f /root/ref/crate/src/Cargo.toml
cat > /root/ref/crate/Cargo.toml <<'TOML'
[package]
name = "bun_webp"
version = "0.0.0"
edition = "2024"
[lib]
path = "src/lib.rs"
[dependencies]
thiserror = "2"
bun_alloc = { path = "../bun_alloc" }
TOML
cat > /root/ref/crate/src/dev_hooks.rs <<'RS'
//! Internals for the harness. Not part of the crate in the repository.
pub fn alpha_decode(data: &[u8], width: usize, height: usize) -> Result<Vec<u8>, crate::Error> {
    crate::alpha::dec::decode(data, width, height)
}
pub fn alpha_encode(alpha: &[u8], width: usize, height: usize) -> Result<Vec<u8>, crate::Error> {
    crate::alpha::enc::encode(alpha, width, height)
}
RS
sed -i 's/^mod demux;$/mod demux;\npub mod dev_hooks;/' /root/ref/crate/src/lib.rs
for pair in main:main-harness vp8l-dec:vp8l-dec/harness vp8-dec:vp8-dec/harness vp8l-enc:vp8l-enc/harness vp8-enc:vp8-enc/harness; do
  n=${pair%%:*}; s="$W/webp-port-wip/${pair##*:}"
  [ -d "$s" ] && [ ! -d /root/ref/h/$n ] || continue
  mkdir -p /root/ref/h/$n
  cp -r "$s"/. /root/ref/h/$n/
  sed -i 's|^bun_webp = .*|bun_webp = { path = "/root/ref/crate" }|' /root/ref/h/$n/Cargo.toml
  cp "$W/rust-toolchain.toml" /root/ref/h/$n/
done
ls /root/ref/h
