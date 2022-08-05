#!/usr/bin/env bash

set -euxo pipefail

export DOCKER_BUILDKIT=1

export BUILDKIT_ARCH=$(uname -m)
export ARCH=${BUILDKIT_ARCH}

if [ "$BUILDKIT_ARCH" == "amd64" ]; then
    export BUILDKIT_ARCH="amd64"
    export ARCH=x64
fi

if [ "$BUILDKIT_ARCH" == "x86_64" ]; then
    export BUILDKIT_ARCH="amd64"
    export ARCH=x64
fi

if [ "$BUILDKIT_ARCH" == "arm64" ]; then
    export BUILDKIT_ARCH="arm64"
    export ARCH=aarch64
fi

if [ "$BUILDKIT_ARCH" == "aarch64" ]; then
    export BUILDKIT_ARCH="arm64"
    export ARCH=aarch64
fi

if [ "$BUILDKIT_ARCH" == "armv7l" ]; then
    echo "Unsupported platform: $BUILDKIT_ARCH"
    exit 1
fi

# Name should be $BUILDKIT_ARCH so we only need that arg passed
export CONTAINER_NAME=zig-linux-$BUILDKIT_ARCH
export TAG=mar4

temp=$(mktemp -d)

docker build . -t $CONTAINER_NAME --progress=plain --platform=linux/$BUILDKIT_ARCH --build-arg TAG=$TAG

if (($?)); then
    echo "Failed to build container"
    exit 1
fi

id=$(docker create $CONTAINER_NAME:latest)
docker cp $id:/output/zig.zip $temp/$CONTAINER_NAME.zip

if (($?)); then
    echo "Failed to cp out"
    exit 1
fi

docker rm $id

gh release upload $TAG $temp/$CONTAINER_NAME.zip --clobber --repo oven-sh/zig
