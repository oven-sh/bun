# OpenTelemetry Integration Test

End-to-end integration test for Bun's OpenTelemetry instrumentation.

## Prerequisites

- Docker installed
- Bun debug build available (or test will build it)
- **Optional**: [oha](https://github.com/hatoo/oha) for faster load generation (`brew install oha`)

## Running the Test

```bash
# Run test (auto-cleanup in CI environments)
bun test/integration/telemetry/test.ts

# Run test and keep containers for inspection
bun test/integration/telemetry/test.ts --interactive
```

## What It Tests

1. ✅ **Span Creation**: BunSDK creates spans correctly
2. ✅ **Trace Export**: Traces export via OTLP to Jaeger
3. ✅ **Distributed Tracing**: Multi-span traces (parent-child relationships)
4. ✅ **Error Tracking**: Error spans are captured and marked
5. ✅ **Dynamic Ports**: No hardcoded ports = CI-safe

## Architecture

```
Bun App (host) → Jaeger v2 (Docker) → Verify traces via API
```

- **Bun app**: Runs on host using debug build (tests your actual changes)
- **Jaeger v2**: Runs in Docker with dynamic port allocation (no port conflicts)
- **Test script**: Generates load and verifies traces appear in Jaeger

### Why Host + Docker?

**Problem**: Mac builds Mach-O binaries, Docker needs ELF (Linux format)
**Solution**: Run Bun app on host, only Jaeger in Docker
**Benefit**: Tests your actual debug build without cross-compilation

## Implementation Details

### Dynamic Ports
- Jaeger runs with `-p 0:4318 -p 0:16686` (Docker assigns random ports)
- Test script uses `docker port` to discover assigned ports
- No hardcoded ports = no CI conflicts

### Clean Architecture
- No docker-compose complexity
- Simple `docker run` for Jaeger only
- Bun shell (`$`) for cross-platform support
- Smart cleanup (auto in CI, prompt in dev)

## Current Status

⚠️ **Blocked on ENV support** - BunSDK needs to respect `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable (work in progress).

Once ENV support is complete, this test will verify end-to-end functionality.

## Manual Cleanup

If containers are left running:

```bash
docker stop bun-telemetry-jaeger
```
