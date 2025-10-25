#!/usr/bin/env bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Starting OpenTelemetry integration test...${NC}"

# Get the bun debug build (repo root is 3 levels up)
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUN_DEBUG="${BUN_DEBUG:-$REPO_ROOT/build/debug/bun-debug}"
if [ ! -f "$BUN_DEBUG" ]; then
  echo -e "${RED}Error: Debug build not found at $BUN_DEBUG${NC}"
  echo "Run 'bun bd' first to create debug build"
  exit 1
fi

echo -e "${GREEN}Using Bun debug build: $BUN_DEBUG${NC}"

# Start docker compose
echo -e "${YELLOW}Starting OTLP collector and Jaeger...${NC}"
docker-compose up -d
sleep 5  # Wait for services to be ready

# Function to cleanup
cleanup() {
  echo -e "${YELLOW}Cleaning up...${NC}"
  kill $SERVER_PID 2>/dev/null || true
  docker-compose down
}
trap cleanup EXIT

# Start Bun server with telemetry (suppress debug logs for cleaner output)
echo -e "${YELLOW}Starting Bun server with telemetry enabled...${NC}"
BUN_DEBUG_QUIET_LOGS=1 $BUN_DEBUG app.ts > /dev/null 2>&1 &
SERVER_PID=$!
sleep 3  # Wait for server to start

# Health check
if ! curl -s http://localhost:3000/health > /dev/null; then
  echo -e "${RED}Error: Server failed to start${NC}"
  exit 1
fi
echo -e "${GREEN}Server is healthy${NC}"

# Run load test with oha
echo -e "${YELLOW}Running load test with oha...${NC}"
if command -v oha &> /dev/null; then
  # Run 1000 requests with 10 concurrent connections
  oha -n 1000 -c 10 http://localhost:3000/api/test

  # Run some distributed tracing requests
  oha -n 100 -c 5 http://localhost:3000/api/test?downstream=true

  # Generate some errors
  oha -n 50 -c 2 http://localhost:3000/api/error || true
else
  echo -e "${YELLOW}oha not found, using curl for basic testing${NC}"
  for i in {1..100}; do
    curl -s http://localhost:3000/api/test > /dev/null
  done
  for i in {1..20}; do
    curl -s http://localhost:3000/api/test?downstream=true > /dev/null
  done
fi

# Wait for traces to be exported
echo -e "${YELLOW}Waiting for traces to be exported...${NC}"
sleep 5

# Query Jaeger API to verify traces
echo -e "${YELLOW}Querying Jaeger API for traces...${NC}"
TRACES=$(curl -s "http://localhost:16686/api/traces?service=integration-test-service&limit=100")

# Check if we got traces
TRACE_COUNT=$(echo "$TRACES" | jq -r '.data | length')
if [ "$TRACE_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓ Success! Found $TRACE_COUNT traces in Jaeger${NC}"

  # Show some stats
  echo -e "\n${YELLOW}Trace Statistics:${NC}"
  echo "$TRACES" | jq -r '.data[] | "  - Trace ID: \(.traceID) | Spans: \(.spans | length)"' | head -10

  # Check for distributed traces
  DISTRIBUTED_TRACES=$(echo "$TRACES" | jq -r '[.data[] | select(.spans | length > 1)] | length')
  echo -e "\n${GREEN}Found $DISTRIBUTED_TRACES multi-span traces (distributed tracing working!)${NC}"

  # Check for error spans
  ERROR_SPANS=$(echo "$TRACES" | jq -r '[.data[].spans[] | select(.tags[] | select(.key == "error" and .value == true))] | length')
  echo -e "${GREEN}Found $ERROR_SPANS error spans (error tracking working!)${NC}"

  echo -e "\n${GREEN}Jaeger UI available at: http://localhost:16686${NC}"
  exit 0
else
  echo -e "${RED}✗ Failed! No traces found in Jaeger${NC}"
  echo -e "${YELLOW}Check OTLP collector logs:${NC}"
  docker-compose logs otel-collector | tail -50
  exit 1
fi
