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
    const fsTraces = traces.filter(t => t[0] === "fs");
    expect(fsTraces.length).toBeGreaterThan(0);

    // Check for open/read/write operations
    const calls = fsTraces.map(t => t[2]);
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
    const fsTraces = traces.filter(t => t[0] === "fs");
    expect(fsTraces.length).toBeGreaterThan(0);

    // Check that we logged open and close operations
    const calls = fsTraces.map(t => t[2]);
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
    const fetchTraces = traces.filter(t => t[0] === "fetch");
    expect(fetchTraces.length).toBeGreaterThan(0);

    // Check for response
    const responseCalls = fetchTraces.filter(t => t[2] === "response");
    expect(responseCalls.length).toBeGreaterThan(0);

    // Should have URL
    expect(responseCalls[0][3].url).toContain("example.com");
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
    const bodyTraces = traces.filter(t => t[0] === "response_body");
    expect(bodyTraces.length).toBeGreaterThan(0);

    // Check for text call
    const textCalls = bodyTraces.filter(t => t[2] === "text");
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
      expect(trace[0]).toBeDefined();
      expect(trace[1]).toBeDefined();
      expect(trace[3]).toBeDefined();

      // ns should be a string
      expect(typeof trace[0]).toBe("string");

      // ts should be a number (timestamp)
      expect(typeof trace[1]).toBe("number");

      // data should be an object
      expect(typeof trace[3]).toBe("object");
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

  test("trace high-level readFile/writeFile", async () => {
    using dir = tempDir("trace-highlevel-rw", {
      "test.js": `
        import { readFileSync, writeFileSync } from "fs";
        writeFileSync("test.txt", "hello world");
        const content = readFileSync("test.txt", "utf8");
        console.log("content:", content);
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
    expect(stdout).toContain("hello world");

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    const fsTraces = traces.filter(t => t[0] === "fs");
    expect(fsTraces.length).toBeGreaterThan(0);

    // Check for writeFile
    const writeCalls = fsTraces.filter(t => t[2] === "writeFile");
    expect(writeCalls.length).toBeGreaterThan(0);
    expect(writeCalls.some(t => t[3].path && t[3].path.includes("test.txt"))).toBe(true);

    // Check for readFile
    const readCalls = fsTraces.filter(t => t[2] === "readFile");
    expect(readCalls.length).toBeGreaterThan(0);
    expect(readCalls.some(t => t[3].path && t[3].path.includes("test.txt"))).toBe(true);
  });

  test("trace stat operations", async () => {
    using dir = tempDir("trace-stat", {
      "test.js": `
        import { writeFileSync, statSync } from "fs";
        writeFileSync("test.txt", "data");
        const stats = statSync("test.txt");
        console.log("size:", stats.size);
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

    const fsTraces = traces.filter(t => t[0] === "fs");

    // Check for stat
    const statCalls = fsTraces.filter(t => t[2] === "stat");
    expect(statCalls.length).toBeGreaterThan(0);
    expect(statCalls.some(t => t[3].path && t[3].path.includes("test.txt"))).toBe(true);
  });

  test("trace directory operations", async () => {
    using dir = tempDir("trace-dir-ops", {
      "test.js": `
        import { mkdirSync, rmdirSync, readdirSync, writeFileSync, unlinkSync } from "fs";
        mkdirSync("testdir");
        writeFileSync("testdir/file.txt", "data");
        const files = readdirSync("testdir");
        console.log("files:", files);
        unlinkSync("testdir/file.txt");
        rmdirSync("testdir");
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

    const fsTraces = traces.filter(t => t[0] === "fs");

    // Check for mkdir
    const mkdirCalls = fsTraces.filter(t => t[2] === "mkdir");
    expect(mkdirCalls.length).toBeGreaterThan(0);

    // Check for readdir
    const readdirCalls = fsTraces.filter(t => t[2] === "readdir");
    expect(readdirCalls.length).toBeGreaterThan(0);

    // Check for unlink
    const unlinkCalls = fsTraces.filter(t => t[2] === "unlink");
    expect(unlinkCalls.length).toBeGreaterThan(0);

    // Check for rmdir
    const rmdirCalls = fsTraces.filter(t => t[2] === "rmdir");
    expect(rmdirCalls.length).toBeGreaterThan(0);
  });

  test("trace rename operations", async () => {
    using dir = tempDir("trace-rename", {
      "test.js": `
        import { writeFileSync, renameSync, unlinkSync } from "fs";
        writeFileSync("old.txt", "data");
        renameSync("old.txt", "new.txt");
        unlinkSync("new.txt");
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

    expect(exitCode).toBe(0);

    const traceContent = readFileSync(traceFile, "utf8");
    const traces = traceContent
      .trim()
      .split("\n")
      .filter(l => l.length > 0)
      .map(l => JSON.parse(l));

    const fsTraces = traces.filter(t => t[0] === "fs");

    // Check for rename
    const renameCalls = fsTraces.filter(t => t[2] === "rename");
    expect(renameCalls.length).toBeGreaterThan(0);
  });
});
