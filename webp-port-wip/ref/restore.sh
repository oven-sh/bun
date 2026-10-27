#!/bin/bash
# Rebuilds the porting environment on a fresh VM. Run from the repo root: bash webp-port-wip/ref/restore.sh
set -ex
REPO=$(pwd)
M=23; . /etc/os-release
if ! command -v clang-$M; then
  curl -fsS -o /tmp/llvm.asc https://apt.llvm.org/llvm-snapshot.gpg.key
  sudo install -D -m 0644 /tmp/llvm.asc /etc/apt/keyrings/apt.llvm.org.asc
  echo "deb [signed-by=/etc/apt/keyrings/apt.llvm.org.asc] https://apt.llvm.org/$VERSION_CODENAME/ llvm-toolchain-$VERSION_CODENAME-$M main" | sudo tee /etc/apt/sources.list.d/llvm-$M.list
  sudo apt-get update
  sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends clang-$M lld-$M llvm-$M libclang-rt-$M-dev perl ruby libicu-dev
fi
if [ ! -x ~/.cargo/bin/rustup ]; then
  mkdir -p /root/ref/dl/rustup && cd /root/ref/dl/rustup
  curl -fsSL -o rustup-init https://static.rust-lang.org/rustup/archive/1.28.2/x86_64-unknown-linux-gnu/rustup-init
  echo "20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c  rustup-init" | sha256sum -c
  chmod +x rustup-init && ./rustup-init -y --no-modify-path --profile minimal --default-toolchain none
fi
cp $REPO/webp-port-wip/ref/bun-dev-env ~/.bun-dev-env; . ~/.bun-dev-env
cd $REPO && rustup toolchain install
mkdir -p /root/ref/dl /root/ref/libwebp
[ -f /root/ref/libwebp/COPYING ] || { curl -fsSL -o /root/ref/dl/libwebp.tar.gz https://github.com/webmproject/libwebp/archive/b7e29b9d75bd31422b00c2a446d49d7af06c328d.tar.gz; tar -xzf /root/ref/dl/libwebp.tar.gz -C /root/ref/libwebp --strip-components=1; }
cp -r $REPO/webp-port-wip/ref/{PORTING.md,new-harness.sh,build,cov,harness,select,corpus} /root/ref/
chmod +x /root/ref/new-harness.sh /root/ref/build/build.sh /root/ref/cov/build.sh
/root/ref/build/build.sh
mkdir -p /root/ref/corpus/img && bun /root/ref/corpus/mkimg.ts
