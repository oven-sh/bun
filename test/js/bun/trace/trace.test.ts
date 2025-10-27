import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe("--trace flag", () => {
  test("basic trace file creation", async () => {
    using dir = tempDir("trace-basic", {
      "test.js": `console.log("hello");`,
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

    expect(stdout).toBe("hello\n");
    expect(exitCode).toBe(0);

    // Trace file should exist
    const traceContent = readFileSync(traceFile, "utf8");
    expect(traceContent.length).toBeGreaterThan(0);
  });

  test("trace fs operations", async () => {
    using dir = tempDir("trace-fs", {
      "test.js": `
        import { readFileSync, writeFileSync } from "fs";
        writeFileSync("output.txt", "test data");
        const data = readFileSync("output.txt", "utf8");
        console.log(data);
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

    expect(stdout).toBe("test data\n");
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

  test("trace Bun.write operations", async () => {
    using dir = tempDir("trace-bun-write", {
      "test.js": `
        await Bun.write("output.txt", "hello from Bun.write");
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

    // Should have bun_write namespace entries
    const bunWriteTraces = traces.filter(t => t.ns === "bun_write");
    expect(bunWriteTraces.length).toBeGreaterThan(0);

    // Check that we logged write operations
    const writeCalls = bunWriteTraces.filter(t => t.data.call === "write");
    expect(writeCalls.length).toBeGreaterThan(0);
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
