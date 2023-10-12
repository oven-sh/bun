#!/bin/bash
set -e

cd tools/
rm -rf zig/ zls/

# Download the specific Zig version
ZIG_URL="https://ziglang.org/builds/zig-linux-x86_64-0.12.0-dev.163+6780a6bbf.tar.xz"
echo "Installing Zig version 0.12.0-dev.163+6780a6bbf"
wget --quiet --output-document=- "$ZIG_URL" | tar Jx
mv zig-linux-x86_64-* zig
echo "Zig version $(./zig/zig version)"

echo "Installing latest ZLS - Zig Language Server"
git clone --quiet --recurse-submodules https://github.com/zigtools/zls
cd zls
set +e
../zig/zig build -Ddata_version=master
exit 0
