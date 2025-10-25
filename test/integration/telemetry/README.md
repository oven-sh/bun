# OpenTelemetry Integration Test

End-to-end integration test for Bun's OpenTelemetry support using real OTLP collector and Jaeger backend.

## Prerequisites

- Docker and docker-compose
- Bun debug build (`bun bd`)
- oha (optional, for better load testing: `brew install oha`)

## Running the Test

```bash
cd test/integration/telemetry
./test.sh
```

## What it Tests

1. **Trace Export**: Verifies traces are successfully exported to OTLP collector and stored in Jaeger
2. **Distributed Tracing**: Tests W3C TraceContext propagation across service boundaries (parent-child spans)
3. **Error Tracking**: Validates error spans are created and marked correctly
4. **Performance**: Uses oha to generate realistic load (1000+ requests) to verify overhead is acceptable
5. **HTTP Semantic Conventions**: Ensures spans include proper OpenTelemetry attributes

## Architecture

```
Bun Server (app.ts)
  └─> BunSDK
      └─> OTLP HTTP Exporter (localhost:4318)
          └─> OpenTelemetry Collector
              └─> Jaeger Backend

Load Test: oha → Bun Server → Generates spans → OTLP → Jaeger
```

## Viewing Results

After the test runs, Jaeger UI is available at http://localhost:16686

You can:
- Browse traces by service name: `integration-test-service`
- Inspect individual spans and their attributes
- Verify distributed trace relationships
- Check error spans

## Manual Testing

Start services and server:
```bash
docker-compose up -d
bun bd app.ts
```

Generate traffic:
```bash
# Basic requests
oha -n 1000 -c 10 http://localhost:3000/api/test

# Distributed tracing
oha -n 100 -c 5 http://localhost:3000/api/test?downstream=true

# Errors
oha -n 50 -c 2 http://localhost:3000/api/error
```

Query traces:
```bash
curl "http://localhost:16686/api/traces?service=integration-test-service" | jq
```

Cleanup:
```bash
docker-compose down
```
