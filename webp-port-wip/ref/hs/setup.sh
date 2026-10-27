#!/bin/bash
# usage: setup.sh   (after /root/ref/new-harness.sh <checkout>)
# Makes /root/ref/hs/crate, a private copy of /root/ref/crate with hooks on its histogram costs, and builds the driver.
set -e
cd /root/ref/hs
rm -rf crate && cp -r /root/ref/crate crate
sed -i 's|path = "../bun_alloc"|path = "/root/ref/bun_alloc"|' crate/Cargo.toml
{ echo '#[allow(clippy::all, clippy::restriction)]'; echo 'mod hooks {'; echo 'use super::*;'; cat hook.rs; echo '}'; echo 'pub use hooks::{hook_add_thresh, hook_bits_entropy, hook_estimate};'; } >> crate/src/vp8l/enc/histogram.rs
sed -i -E 's/^(pub\(crate\) )?mod histogram;/pub(crate) mod histogram;/' crate/src/vp8l/enc/mod.rs
echo 'pub use crate::vp8l::enc::histogram::{hook_add_thresh, hook_bits_entropy, hook_estimate};' >> crate/src/dev_hooks.rs
(cd /root/ref/libwebp && cp /root/ref/hs/hs_shim.c . && ${CC:-clang-23} -O2 -g -fPIC -I. -Isrc -c hs_shim.c -o /root/ref/hs/hs_shim.o && rm hs_shim.c)
${OBJCOPY:-llvm-objcopy-23} -G hs_estimate -G hs_bits_entropy -G hs_add_thresh -G hs_init hs_shim.o
rm -f libhsshim.a && ${AR:-llvm-ar-23} rcs libhsshim.a hs_shim.o
cp /root/ref/h/main/src/images.rs /root/ref/h/main/src/reference.rs src/
cp /root/ref/h/main/rust-toolchain.toml . 2>/dev/null || true
sed -i 's/^use fzgen::images::Rng;/#[allow(dead_code)]\nmod images;\n#[allow(dead_code)]\nmod reference;\nuse images::Rng;/; s/fzgen::reference::disable_simd/reference::disable_simd/' src/main.rs
cat > Cargo.toml <<'T'
[package]
name = "hs"
version = "0.0.0"
edition = "2024"
[workspace]
[dependencies]
bun_webp = { path = "crate" }
[profile.release]
overflow-checks = true
debug-assertions = true
panic = "abort"
T
cat > build.rs <<'T'
fn main() {
    println!("cargo:rustc-link-search=native=/root/ref/hs");
    println!("cargo:rustc-link-search=native=/root/ref/build");
    println!("cargo:rustc-link-lib=static=hsshim");
    println!("cargo:rustc-link-lib=static=webp_ref");
}
T
cargo build --release
