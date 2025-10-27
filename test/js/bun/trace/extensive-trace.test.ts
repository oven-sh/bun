import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("extensive tracing", () => {
  test("comprehensive fs operations tracing", async () => {
    using dir = tempDir("trace-fs-extensive", {
      "test.js": `
        import { openSync, writeSync, readSync, closeSync, unlinkSync } from "fs";

        // Test open, write, close
        const fd1 = openSync("file1.txt", "w");
        writeSync(fd1, "hello world");
        closeSync(fd1);

        // Test open for read, read, close
        const fd2 = openSync("file1.txt", "r");
        const buf = Buffer.alloc(100);
        const bytesRead = readSync(fd2, buf, 0, 100, 0);
        console.log("read", bytesRead, "bytes");
        closeSync(fd2);

        // Test multiple writes
        const fd3 = openSync("file2.txt", "w");
        writeSync(fd3, "line 1\\n");
        writeSync(fd3, "line 2\\n");
        writeSync(fd3, "line 3\\n");
        closeSync(fd3);

        console.log("fs operations complete");
      `,
    });

    const traceFile = join(String(dir), "trace.jsonl");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--trace", traceFile, "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("fs operations complete");

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    // Should have fs namespace
    const fsTraces = traces.filter(t => t.ns === "fs");
    expect(fsTraces.length).toBeGreaterThan(0);

    // Check we have open operations
    const opens = fsTraces.filter(t => t.data.call === "open");
    expect(opens.length).toBeGreaterThanOrEqual(3);

    // Verify open trace has required fields
    expect(opens[0].data).toHaveProperty("path");
    expect(opens[0].data).toHaveProperty("flags");
    expect(opens[0].data).toHaveProperty("mode");
    expect(opens[0].data).toHaveProperty("fd");

    // Check we have write operations
    const writes = fsTraces.filter(t => t.data.call === "write");
    expect(writes.length).toBeGreaterThanOrEqual(4);

    // Verify write trace has required fields
    expect(writes[0].data).toHaveProperty("fd");
    expect(writes[0].data).toHaveProperty("length");
    expect(writes[0].data).toHaveProperty("bytes_written");

    // Check we have read operations
    const reads = fsTraces.filter(t => t.data.call === "read");
    expect(reads.length).toBeGreaterThanOrEqual(1);

    // Verify read trace has required fields
    expect(reads[0].data).toHaveProperty("fd");
    expect(reads[0].data).toHaveProperty("length");
    expect(reads[0].data).toHaveProperty("bytes_read");

    // Check we have close operations
    const closes = fsTraces.filter(t => t.data.call === "close");
    expect(closes.length).toBeGreaterThanOrEqual(3);

    // Verify close trace has required fields
    expect(closes[0].data).toHaveProperty("fd");
  });

  test("comprehensive fetch/HTTP tracing", async () => {
    using dir = tempDir("trace-fetch-extensive", {
      "test.js": `
        // Multiple sequential fetches
        const r1 = await fetch("https://example.com");
        const t1 = await r1.text();
        console.log("fetch 1:", t1.length, "bytes");

        const r2 = await fetch("https://example.com");
        const t2 = await r2.text();
        console.log("fetch 2:", t2.length, "bytes");

        console.log("fetches complete");
      `,
    });

    const traceFile = join(String(dir), "trace.jsonl");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--trace", traceFile, "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("fetches complete");

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    // Should have fetch namespace
    const fetchTraces = traces.filter(t => t.ns === "fetch");
    expect(fetchTraces.length).toBeGreaterThan(0);

    // Check we have request initiations
    const requests = fetchTraces.filter(t => t.data.call === "request");
    expect(requests.length).toBeGreaterThanOrEqual(2);

    // Verify request trace has required fields
    expect(requests[0].data).toHaveProperty("url");
    expect(requests[0].data).toHaveProperty("method");
    expect(requests[0].data.method).toBe("GET");

    // Check we have responses
    const responses = fetchTraces.filter(t => t.data.call === "response");
    expect(responses.length).toBeGreaterThanOrEqual(2);

    // Verify response trace has required fields
    expect(responses[0].data).toHaveProperty("url");
    expect(responses[0].data).toHaveProperty("status");
    expect(responses[0].data).toHaveProperty("body_size");

    // Should have response_body namespace
    const bodyTraces = traces.filter(t => t.ns === "response_body");
    expect(bodyTraces.length).toBeGreaterThan(0);

    // Check body consumption
    const textCalls = bodyTraces.filter(t => t.data.call === "text");
    expect(textCalls.length).toBeGreaterThanOrEqual(2);
  }, 10_000);

  test("mixed operations tracing", async () => {
    using dir = tempDir("trace-mixed", {
      "test.js": `
        import { openSync, writeSync, closeSync, readFileSync } from "fs";

        // File operation
        const fd = openSync("data.txt", "w");
        writeSync(fd, "initial data");
        closeSync(fd);

        // HTTP operation
        const response = await fetch("https://example.com");
        const html = await response.text();

        // Write HTTP response to file
        const fd2 = openSync("output.html", "w");
        writeSync(fd2, html);
        closeSync(fd2);

        // Read it back
        const content = readFileSync("output.html", "utf8");
        console.log("wrote and read", content.length, "bytes");
      `,
    });

    const traceFile = join(String(dir), "trace.jsonl");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--trace", traceFile, "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    // Should have both fs and fetch traces
    const namespaces = new Set(traces.map(t => t.ns));
    expect(namespaces.has("fs")).toBe(true);
    expect(namespaces.has("fetch")).toBe(true);
    expect(namespaces.has("response_body")).toBe(true);

    // All traces should have timestamp
    traces.forEach(t => {
      expect(t).toHaveProperty("ts");
      expect(typeof t.ts).toBe("number");
      expect(t.ts).toBeGreaterThan(0);
    });

    // All traces should have namespace
    traces.forEach(t => {
      expect(t).toHaveProperty("ns");
      expect(typeof t.ns).toBe("string");
      expect(t.ns.length).toBeGreaterThan(0);
    });

    // All traces should have data
    traces.forEach(t => {
      expect(t).toHaveProperty("data");
      expect(typeof t.data).toBe("object");
      expect(t.data).toHaveProperty("call");
    });
  });

  test("trace namespace filtering", async () => {
    using dir = tempDir("trace-filter", {
      "test.js": `
        import { openSync, writeSync, closeSync } from "fs";
        const fd = openSync("test.txt", "w");
        writeSync(fd, "hello");
        closeSync(fd);
        const r = await fetch("https://example.com");
        await r.text();
        console.log("done");
      `,
    });

    const traceFile = join(String(dir), "trace.jsonl");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--trace", traceFile, "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    await proc.exited;

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    // Can filter by namespace
    const fsOnly = traces.filter(t => t.ns === "fs");
    const fetchOnly = traces.filter(t => t.ns === "fetch");
    const bodyOnly = traces.filter(t => t.ns === "response_body");

    expect(fsOnly.length).toBeGreaterThan(0);
    expect(fetchOnly.length).toBeGreaterThan(0);
    expect(bodyOnly.length).toBeGreaterThan(0);

    // Each namespace should only have its own traces
    fsOnly.forEach(t => expect(t.ns).toBe("fs"));
    fetchOnly.forEach(t => expect(t.ns).toBe("fetch"));
    bodyOnly.forEach(t => expect(t.ns).toBe("response_body"));
  });

  test("trace chronological ordering", async () => {
    using dir = tempDir("trace-ordering", {
      "test.js": `
        import { openSync, writeSync, closeSync } from "fs";

        const fd1 = openSync("file1.txt", "w");
        writeSync(fd1, "first");
        closeSync(fd1);
        await new Promise(r => setTimeout(r, 10));

        const fd2 = openSync("file2.txt", "w");
        writeSync(fd2, "second");
        closeSync(fd2);
        await new Promise(r => setTimeout(r, 10));

        const fd3 = openSync("file3.txt", "w");
        writeSync(fd3, "third");
        closeSync(fd3);

        console.log("done");
      `,
    });

    const traceFile = join(String(dir), "trace.jsonl");

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--trace", traceFile, "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    await proc.exited;

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    // Timestamps should be monotonically increasing
    for (let i = 1; i < traces.length; i++) {
      expect(traces[i].ts).toBeGreaterThanOrEqual(traces[i - 1].ts);
    }
  });
});
