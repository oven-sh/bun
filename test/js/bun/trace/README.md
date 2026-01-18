# Trace Tests

Tests for the `--trace` flag functionality that provides structured logging of I/O operations.

## Test Files

### `trace.test.ts`
Basic functionality tests covering:
- Trace file creation and format
- Low-level fs operations (open, read, write, close)
- High-level fs operations (readFile, writeFile, stat, mkdir, rmdir, unlink, rename, readdir)
- HTTP/fetch operations
- Response body consumption
- Error handling (invalid trace file path)

### `extensive-trace.test.ts`
Comprehensive integration tests covering:
- Multiple sequential fs operations
- Multiple sequential HTTP requests
- Mixed fs + HTTP operations
- Namespace filtering
- Chronological ordering
- Complete trace format validation

## Running Tests

```bash
# Run all trace tests
bun bd test test/js/bun/trace/

# Run specific test file
bun bd test test/js/bun/trace/trace.test.ts

# Run specific test
bun bd test test/js/bun/trace/trace.test.ts -t "trace high-level"
```

## Writing New Trace Tests

### Test Structure

```typescript
import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("your test name", async () => {
  // 1. Create test files in temp directory
  using dir = tempDir("test-prefix", {
    "test.js": `
      // Your test script here
      import { writeFileSync } from "fs";
      writeFileSync("test.txt", "data");
      console.log("done");
    `,
  });

  // 2. Set up trace file path
  const traceFile = join(String(dir), "trace.jsonl");

  // 3. Spawn bun with --trace flag
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--trace", traceFile, "test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  // 4. Wait for completion
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited
  ]);

  // 5. Verify execution
  expect(exitCode).toBe(0);
  expect(stdout).toContain("done");

  // 6. Parse and validate trace
  const traceContent = readFileSync(traceFile, "utf8");
  const traces = traceContent
    .trim()
    .split("\n")
    .filter(l => l.length > 0)
    .map(l => JSON.parse(l));

  // 7. Assert trace properties
  const fsTraces = traces.filter(t => t.ns === "fs");
  expect(fsTraces.length).toBeGreaterThan(0);

  const writeCalls = fsTraces.filter(t => t.data.call === "writeFile");
  expect(writeCalls.length).toBeGreaterThan(0);
});
```

### Important Test Patterns

#### Use Instrumented Operations

Not all fs operations go through instrumented code paths. Use these patterns:

**✅ DO** - These operations ARE traced:
```javascript
// Low-level sync operations
import { openSync, readSync, writeSync, closeSync } from "fs";
const fd = openSync("file.txt", "w");
writeSync(fd, "data");
closeSync(fd);

// High-level sync operations
import { readFileSync, writeFileSync, statSync } from "fs";
writeFileSync("file.txt", "data");
const content = readFileSync("file.txt", "utf8");
const stats = statSync("file.txt");

// Directory operations
import { mkdirSync, readdirSync, rmdirSync, unlinkSync, renameSync } from "fs";
mkdirSync("dir");
const files = readdirSync("dir");
```

**❌ DON'T** - These operations may NOT be traced:
```javascript
// Some async operations may use different code paths
import { readFile, writeFile } from "fs/promises";
await writeFile("file.txt", "data"); // May not be traced
```

#### Testing Fetch Operations

Fetch tests can be slow. Set appropriate timeouts:

```typescript
test(
  "fetch test",
  async () => {
    // Test code that makes HTTP requests
  },
  10_000, // 10 second timeout
);
```

Use `example.com` for test fetches (fast, reliable):
```javascript
const response = await fetch("https://example.com");
```

#### Namespace Filtering

Test that traces are properly namespaced:

```typescript
const fsTraces = traces.filter(t => t.ns === "fs");
const fetchTraces = traces.filter(t => t.ns === "fetch");
const bodyTraces = traces.filter(t => t.ns === "response_body");
const bunWriteTraces = traces.filter(t => t.ns === "bun_write");
```

#### Entry/Exit Traces

Many operations have both entry and exit traces:

```typescript
// Entry trace: operation starting
{"ns":"fs","ts":1761595797038,"data":{"call":"writeFile","path":"test.txt","length":5}}

// Exit trace: operation complete
{"ns":"fs","ts":1761595797038,"data":{"call":"writeFile","path":"test.txt","bytes_written":5}}
```

Test both:
```typescript
const writeCalls = fsTraces.filter(t => t.data.call === "writeFile");
const entryTrace = writeCalls.find(t => t.data.length !== undefined);
const exitTrace = writeCalls.find(t => t.data.bytes_written !== undefined);
expect(entryTrace).toBeDefined();
expect(exitTrace).toBeDefined();
```

### Common Assertions

```typescript
// Trace file exists and has content
expect(traceContent.length).toBeGreaterThan(0);

// Valid JSON lines
const traces = traceContent.trim().split("\n").map(l => JSON.parse(l));

// Required fields
traces.forEach(t => {
  expect(t).toHaveProperty("ns");
  expect(t).toHaveProperty("ts");
  expect(t).toHaveProperty("data");
  expect(t.data).toHaveProperty("call");
});

// Specific operation traced
expect(traces.some(t => t.data.call === "writeFile")).toBe(true);

// Path included in trace
expect(traces.some(t => t.data.path?.includes("test.txt"))).toBe(true);

// Chronological ordering
for (let i = 1; i < traces.length; i++) {
  expect(traces[i].ts).toBeGreaterThanOrEqual(traces[i-1].ts);
}
```

## Debugging Failed Tests

### Test Fails: Empty Trace File

**Cause**: Operation doesn't go through instrumented code path

**Solution**: Use sync operations or high-level APIs that are instrumented:
```typescript
// Instead of this:
await Bun.write("file.txt", "data");

// Use this:
import { writeFileSync } from "fs";
writeFileSync("file.txt", "data");
```

### Test Fails: Missing Expected Operations

**Cause**: Wrong namespace filter or operation name

**Solution**: Print all traces to see what's actually logged:
```typescript
console.log("All traces:", JSON.stringify(traces, null, 2));
```

### Test Fails: Timeout on Fetch Tests

**Cause**: External HTTP requests can be slow

**Solution**: Increase timeout or use faster endpoints:
```typescript
test(
  "fetch test",
  async () => { /* ... */ },
  15_000, // Increase timeout
);
```

## Adding New Trace Points

If you add new trace instrumentation to Bun's source code:

1. **Add the trace call** in the relevant source file:
   ```zig
   traceFS(.{ .call = "newOperation", .path = path, .result = result });
   ```

2. **Rebuild Bun**:
   ```bash
   bun bd
   ```

3. **Add a test** in `trace.test.ts`:
   ```typescript
   test("trace new operation", async () => {
     // Test code that triggers the new operation
     // Verify trace includes expected data
   });
   ```

4. **Verify the test** passes with your changes and fails without:
   ```bash
   # Should pass
   bun bd test test/js/bun/trace/trace.test.ts -t "new operation"

   # Should fail (operation not traced)
   USE_SYSTEM_BUN=1 bun test test/js/bun/trace/trace.test.ts -t "new operation"
   ```

## Coverage Matrix

Current test coverage:

| Operation | Low-level API | High-level API |
|-----------|---------------|----------------|
| File Read | ✅ `readSync` | ✅ `readFileSync` |
| File Write | ✅ `writeSync` | ✅ `writeFileSync` |
| File Open | ✅ `openSync` | N/A |
| File Close | ✅ `closeSync` | N/A |
| File Stat | N/A | ✅ `statSync` |
| Dir Create | N/A | ✅ `mkdirSync` |
| Dir Remove | N/A | ✅ `rmdirSync` |
| Dir List | N/A | ✅ `readdirSync` |
| File Delete | N/A | ✅ `unlinkSync` |
| File Rename | N/A | ✅ `renameSync` |
| HTTP Request | N/A | ✅ `fetch()` |
| Response Body | N/A | ✅ `.text()`, `.json()` |
| Bun.write | N/A | ⚠️  Instrumented but not tested |

**Legend:**
- ✅ Fully tested
- ⚠️  Instrumented but needs tests
- N/A Not applicable
