#!/bin/bash

# Create a test workspace structure similar to putout
mkdir -p test-workspace
cd test-workspace

# Create root package.json with workspaces
cat > package.json << 'EOF'
{
  "name": "test-workspace-root",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "dependencies": {
    "@test-workspace/package-a": "workspace:*",
    "@test-workspace/package-b": "workspace:*"
  }
}
EOF

# Create workspace packages
mkdir -p packages/package-a
cat > packages/package-a/package.json << 'EOF'
{
  "name": "@test-workspace/package-a",
  "version": "1.0.0",
  "dependencies": {
    "@test-workspace/package-b": "workspace:*"
  }
}
EOF

mkdir -p packages/package-b
cat > packages/package-b/package.json << 'EOF'
{
  "name": "@test-workspace/package-b",
  "version": "1.0.0"
}
EOF

echo "Test workspace structure created!"
echo "Running 'bun install' twice to test if PathAlreadyExists is handled correctly..."

# First install - should work
echo "First install:"
bun install

# Second install - this is where the bug would occur
echo "Second install (should not fail with PathAlreadyExists):"
bun install

# Check if symlinks were created correctly
echo "Checking symlinks in node_modules:"
ls -la node_modules/@test-workspace/

# Clean up
cd ..
rm -rf test-workspace