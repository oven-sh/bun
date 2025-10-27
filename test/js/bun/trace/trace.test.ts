import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("--trace flag", () => {
  test("basic trace file creation", async () => {
    using dir = tempDir("trace-basic", {
      "test.js": `
        import { openSync, writeSync, closeSync } from "fs";
        const fd = openSync("test.txt", "w");
        writeSync(fd, "hello");
        closeSync(fd);
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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);

    // Trace file should exist and have content
    const traceContent = readFileSync(traceFile, "utf8");
    expect(traceContent.length).toBeGreaterThan(0);

    // Should have at least 3 trace lines (open, write, close)
    const lines = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  test("trace fs operations", async () => {
    using dir = tempDir("trace-fs", {
      "test.js": `
        import { openSync, writeSync, readSync, closeSync } from "fs";
        const fd1 = openSync("output.txt", "w");
        writeSync(fd1, "test data");
        closeSync(fd1);

        const fd2 = openSync("output.txt", "r");
        const buf = Buffer.alloc(100);
        readSync(fd2, buf, 0, 100, 0);
        closeSync(fd2);
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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);

    // Parse trace file
    const traceContent = readFileSync(traceFile, "utf8");
    const traceLines = traceContent
      .trim()
      .split("\n")
      .filter(line => line.length > 0);

    expect(traceLines.length).toBeGreaterThan(0);

    // Parse each line as JSON
    const traces = traceLines.map(line => JSON.parse(line));

    // Should have fs namespace entries
    const fsTraces = traces.filter(t => t.ns === "fs");
    expect(fsTraces.length).toBeGreaterThan(0);

    // Check for open/read/write operations
    const calls = fsTraces.map(t => t.data.call);
    expect(calls).toContain("open");
  });

  test("trace open and close operations", async () => {
    using dir = tempDir("trace-open-close", {
      "test.js": `
        import { openSync, closeSync } from "fs";
        const fd = openSync("output.txt", "w");
        closeSync(fd);
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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);

    // Parse trace file
    const traceContent = readFileSync(traceFile, "utf8");
    const traceLines = traceContent
      .trim()
      .split("\n")
      .filter(line => line.length > 0);

    const traces = traceLines.map(line => JSON.parse(line));

    // Should have fs namespace entries
    const fsTraces = traces.filter(t => t.ns === "fs");
    expect(fsTraces.length).toBeGreaterThan(0);

    // Check that we logged open and close operations
    const calls = fsTraces.map(t => t.data.call);
    expect(calls).toContain("open");
    expect(calls).toContain("close");
  });

  test("trace fetch operations", async () => {
    using dir = tempDir("trace-fetch", {
      "test.js": `
        const response = await fetch("https://example.com");
        const text = await response.text();
        console.log("fetched");
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

    expect(stdout).toBe("fetched\n");
    expect(exitCode).toBe(0);

    // Parse trace file
    const traceContent = readFileSync(traceFile, "utf8");
    const traceLines = traceContent
      .trim()
      .split("\n")
      .filter(line => line.length > 0);

    const traces = traceLines.map(line => JSON.parse(line));

    // Should have fetch namespace entries
    const fetchTraces = traces.filter(t => t.ns === "fetch");
    expect(fetchTraces.length).toBeGreaterThan(0);

    // Check for response
    const responseCalls = fetchTraces.filter(t => t.data.call === "response");
    expect(responseCalls.length).toBeGreaterThan(0);

    // Should have URL
    expect(responseCalls[0].data.url).toContain("example.com");
  });

  test("trace response body operations", async () => {
    using dir = tempDir("trace-response-body", {
      "test.js": `
        const response = await fetch("https://example.com");
        const text = await response.text();
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

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);

    // Parse trace file
    const traceContent = readFileSync(traceFile, "utf8");
    const traceLines = traceContent
      .trim()
      .split("\n")
      .filter(line => line.length > 0);

    const traces = traceLines.map(line => JSON.parse(line));

    // Should have response_body namespace entries
    const bodyTraces = traces.filter(t => t.ns === "response_body");
    expect(bodyTraces.length).toBeGreaterThan(0);

    // Check for text call
    const textCalls = bodyTraces.filter(t => t.data.call === "text");
    expect(textCalls.length).toBeGreaterThan(0);
  });

  test("trace format validation", async () => {
    using dir = tempDir("trace-format", {
      "test.js": `
        import { readFileSync } from "fs";
        const data = readFileSync("test.js", "utf8");
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

    // Parse trace file
    const traceContent = readFileSync(traceFile, "utf8");
    const traceLines = traceContent
      .trim()
      .split("\n")
      .filter(line => line.length > 0);

    // Each line should be valid JSON
    for (const line of traceLines) {
      const trace = JSON.parse(line);

      // Should have required fields
      expect(trace).toHaveProperty("ns");
      expect(trace).toHaveProperty("ts");
      expect(trace).toHaveProperty("data");

      // ns should be a string
      expect(typeof trace.ns).toBe("string");

      // ts should be a number (timestamp)
      expect(typeof trace.ts).toBe("number");

      // data should be an object
      expect(typeof trace.data).toBe("object");
    }
  });

  test("trace file error handling", async () => {
    using dir = tempDir("trace-error", {
      "test.js": `console.log("hello");`,
    });

    const traceFile = "/invalid/path/trace.jsonl";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--trace", traceFile, "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should fail to open trace file
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Failed to open trace file");
  });
});
