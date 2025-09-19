#!/bin/sh
set -eu

# Docker image prepull and build script for CI
# This script ensures all required Docker images are available locally
# to avoid network pulls during test execution

echo "🐳 Docker image preparation starting..."

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Function to check if image exists
image_exists() {
    docker image inspect "$1" >/dev/null 2>&1
}

# Function to pull image if not exists
pull_if_missing() {
    local image="$1"
    if image_exists "$image"; then
        echo "✓ Image $image already exists"
    else
        echo "⬇️  Pulling $image..."
        docker pull "$image"
    fi
}

# Function to build local image
build_local_image() {
    local tag="$1"
    local context="$2"
    local dockerfile="${3:-Dockerfile}"

    if image_exists "$tag"; then
        echo "✓ Local image $tag already exists"
    else
        echo "🔨 Building $tag from $context..."
        docker build -t "$tag" -f "$context/$dockerfile" "$context"
    fi
}

# Ensure Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not in PATH"
    exit 1
fi

# Check Docker daemon is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker daemon is not running"
    exit 1
fi

# Check Docker Compose v2 is available
if ! docker compose version >/dev/null 2>&1; then
    echo "❌ Docker Compose v2 is not available"
    exit 1
fi

echo "📦 Using docker-compose to pull and build all images..."

# Pull all images defined in docker-compose.yml
# This will fail for images that need to be built, which is expected
echo "Pulling all images..."
docker compose pull --quiet 2>/dev/null || docker compose pull || true

echo "🔨 Building images that need building..."

# Build services that require building (mysql_tls, redis_unified)
docker compose build mysql_tls redis_unified

# List of specific images to verify
echo "✅ Verifying images..."
pull_if_missing "postgres:15"
pull_if_missing "mysql:8.4"
pull_if_missing "mysql:8.0"
pull_if_missing "redis:7-alpine"
pull_if_missing "minio/minio:latest"
pull_if_missing "crossbario/autobahn-testsuite"

echo "✅ Validating docker-compose configuration..."

# Validate compose file (we're already in the docker directory)
if docker compose config >/dev/null 2>&1; then
    echo "✓ Docker Compose configuration is valid"
else
    echo "⚠️  Docker Compose configuration validation failed"
    docker compose config
fi

# Optional: Save images to cache (useful for ephemeral CI instances)
if [ "${BUN_DOCKER_SAVE_CACHE:-0}" = "1" ]; then
    CACHE_FILE="/var/cache/bun-docker-images.tar"
    echo "💾 Saving images to cache at $CACHE_FILE..."

    docker save \
        postgres:15 \
        mysql:8.4 \
        mysql:8.0 \
        redis:7-alpine \
        minio/minio:latest \
        crossbario/autobahn-testsuite \
        -o "$CACHE_FILE"

    echo "✓ Images saved to cache"
fi

# Optional: Load images from cache
if [ "${BUN_DOCKER_LOAD_CACHE:-0}" = "1" ]; then
    CACHE_FILE="/var/cache/bun-docker-images.tar"
    if [ -f "$CACHE_FILE" ]; then
        echo "💾 Loading images from cache at $CACHE_FILE..."
        docker load -i "$CACHE_FILE"
        echo "✓ Images loaded from cache"
    else
        echo "⚠️  Cache file not found at $CACHE_FILE"
    fi
fi

echo "🎉 Docker image preparation complete!"

# List all images for verification
echo ""
echo "📋 Available images:"
docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}" | grep -E "(postgres|mysql|redis|minio|autobahn|bun-)" || true