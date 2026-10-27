#!/bin/bash
# usage: setup.sh   (after /root/ref/new-harness.sh <checkout>)
# Makes /root/ref/cm/crate, a private copy of /root/ref/crate with a hook on its CostManager, and builds the driver.
set -e
cd /root/ref/cm
rm -rf crate && cp -r /root/ref/crate crate
sed -i 's|path = "../bun_alloc"|path = "/root/ref/bun_alloc"|' crate/Cargo.toml
F=crate/src/vp8l/enc/backward_references_cost.rs
python3 - "$F" <<'P'
import re,sys
p=sys.argv[1]; s=open(p).read()
# number the three calls in push_interval, in source order
a=s.index('fn push_interval('); b=s.index('\n    }\n',a)
body=s[a:b]; n=[0]
def mark(m):
    i=n[0]; n[0]+=1
    return f'crate::dev_hooks::SITE.store({i}, core::sync::atomic::Ordering::Relaxed);\n{m.group(1)}self.insert_interval('
body=re.sub(r'([ \t]*)self\.insert_interval\(',lambda m: m.group(1)+mark(m),body)
assert n[0]==3,n
s=s[:a]+body+s[b:]
old='let Some(interval_new) = self.free_intervals.pop() else {\n'
assert s.count(old)==1
s=s.replace(old,old+'''            use core::sync::atomic::Ordering::Relaxed;
            if let Some(c) = crate::dev_hooks::BY_SITE.get(crate::dev_hooks::SITE.load(Relaxed)) { c.fetch_add(1, Relaxed); }
            if crate::dev_hooks::BREAK.load(Relaxed) { return Ok(()); }
''')
open(p,'w').write(s+'\n'+open('/root/ref/cm/hook.rs').read())
P
sed -i -E 's/^(pub\(crate\) )?mod backward_references_cost;/pub(crate) mod backward_references_cost;/' crate/src/vp8l/enc/mod.rs
{ cat counters.rs; echo 'pub use crate::vp8l::enc::backward_references_cost::{Hook, Op};'; } >> crate/src/dev_hooks.rs
sed -i 's/^#!\[deny(/#![allow(clippy::all)]\n#![deny(/' crate/src/lib.rs || true
(cd /root/ref/libwebp && cp /root/ref/cm/cm_shim.c . && ${CC:-clang-23} -O2 -g -fPIC -I. -Isrc -c cm_shim.c -o /root/ref/cm/cm_shim.o && rm cm_shim.c)
rm -f libcmshim.a && ${AR:-llvm-ar-23} rcs libcmshim.a cm_shim.o
cp /root/ref/h/main/src/images.rs src/images.rs
cp /root/ref/h/main/rust-toolchain.toml . 2>/dev/null || true
sed -i 's/^use fzgen::images::Rng;/mod images;\nuse images::Rng;/' src/main.rs
cat > Cargo.toml <<'T'
[package]
name = "cm"
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
    println!("cargo:rustc-link-search=native=/root/ref/cm");
    println!("cargo:rustc-link-search=native=/root/ref/build");
    println!("cargo:rustc-link-lib=static=cmshim");
    println!("cargo:rustc-link-lib=static=webp_ref");
}
T
cargo build --release
