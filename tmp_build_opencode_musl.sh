#!/bin/sh
set -eu

mkdir -p /tmp/libicu
ln -sf /workspace/opencode/libicudata.so.76.1 /tmp/libicu/libicudata.so
ln -sf /workspace/opencode/libicuuc.so.76.1 /tmp/libicu/libicuuc.so
ln -sf /workspace/opencode/libicui18n.so.76.1 /tmp/libicu/libicui18n.so
ln -sf /workspace/opencode/libicudata.so.76.1 /tmp/libicu/libicudata.so.76
ln -sf /workspace/opencode/libicuuc.so.76.1 /tmp/libicu/libicuuc.so.76
ln -sf /workspace/opencode/libicui18n.so.76.1 /tmp/libicu/libicui18n.so.76

rm -rf /tmp/opencode
mkdir -p /tmp/opencode
cp -R /workspace/opencode/. /tmp/opencode/

BUN_WORKSPACE=/workspace/bun python3 /workspace/bun/tmp_link_and_test.py
cp /workspace/bun/build/minsize-local-64k-noasan/bun-profile /tmp/bun64k
chmod +x /tmp/bun64k

cd /tmp/opencode/packages/opencode
rm -rf dist

OPENCODE_BUILD_TARGET=opencode-linux-arm64-musl \
MODELS_DEV_API_JSON=/tmp/opencode/models.dev.api.json \
LD_LIBRARY_PATH=/tmp/libicu:/tmp/opencode \
/tmp/bun64k run script/build.ts --skip-install > /tmp/opencode-build.log 2>&1

echo "EXIT:$?"
if [ -e /tmp/opencode/packages/opencode/dist/opencode-linux-arm64-musl/bin/opencode ]; then
  file /tmp/opencode/packages/opencode/dist/opencode-linux-arm64-musl/bin/opencode
  mkdir -p /workspace/opencode/packages/opencode/dist/opencode-linux-arm64-musl/bin
  cp /tmp/opencode/packages/opencode/dist/opencode-linux-arm64-musl/bin/opencode /workspace/opencode/packages/opencode/dist/opencode-linux-arm64-musl/bin/opencode
fi
tail -n 80 /tmp/opencode-build.log
