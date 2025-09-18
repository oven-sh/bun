#!/bin/bash
# Install Docker Compose for CI environments

set -e

# Check if docker compose v2 is available
if docker compose version &>/dev/null; then
    echo "Docker Compose v2 is already installed"
    docker compose version
    exit 0
fi

# Check if docker-compose v1 is available
if docker-compose version &>/dev/null; then
    echo "Docker Compose v1 is already installed"
    docker-compose version
    exit 0
fi

echo "Installing Docker Compose..."

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64)
        ARCH="x86_64"
        ;;
    aarch64|arm64)
        ARCH="aarch64"
        ;;
    *)
        echo "Unsupported architecture: $ARCH"
        exit 1
        ;;
esac

# Install Docker Compose v2 as a Docker plugin
DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
mkdir -p $DOCKER_CONFIG/cli-plugins

# Download Docker Compose v2
COMPOSE_VERSION="v2.24.0"
curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-${OS}-${ARCH}" -o $DOCKER_CONFIG/cli-plugins/docker-compose

# Make it executable
chmod +x $DOCKER_CONFIG/cli-plugins/docker-compose

# Verify installation
if docker compose version; then
    echo "Docker Compose v2 installed successfully"
else
    echo "Failed to install Docker Compose"
    exit 1
fi