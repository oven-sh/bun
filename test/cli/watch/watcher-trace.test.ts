import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("BUN_WATCHER_TRACE creates trace file with watch events", async () => {
  using dir = tempDir("watcher-trace", {
    "index.js": `console.log("hello");`,
    "watcher.js": `
      import { watch } from "fs";
      const watcher = watch(".", { recursive: true }, (eventType, filename) => {
        console.log("WATCHER_EVENT", eventType, filename);
      });
      // Keep the process alive for a bit
      setTimeout(() => {
        watcher.close();
        process.exit(0);
      }, 3000);
    `,
  });

  const traceFile = join(String(dir), "trace.log");
  const env = { ...bunEnv, BUN_WATCHER_TRACE: traceFile };

  await using proc = Bun.spawn({
    cmd: [bunExe(), "watcher.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Give watcher time to initialize
  await Bun.sleep(500);

  // Write to a file to trigger a watch event
  await Bun.write(join(String(dir), "test.txt"), "test content");
  await Bun.sleep(500);

  // Modify the file
  await Bun.write(join(String(dir), "test.txt"), "modified content");
  await Bun.sleep(500);

  // Delete the file
  await Bun.write(join(String(dir), "delete.txt"), "to be deleted");
  await Bun.sleep(300);
  await Bun.$`rm ${join(String(dir), "delete.txt")}`.quiet();
  await Bun.sleep(500);

  const exitCode = await proc.exited;

  // Check that trace file was created
  expect(existsSync(traceFile)).toBe(true);

  const traceContent = readFileSync(traceFile, "utf-8");
  const lines = traceContent.trim().split("\n");

  // Should have at least one event
  expect(lines.length).toBeGreaterThan(0);

  // Parse and validate JSON structure
  for (const line of lines) {
    if (line.trim()) {
      const event = JSON.parse(line);

      // Check required fields exist
      expect(event).toHaveProperty("timestamp");
      expect(event).toHaveProperty("index");
      expect(event).toHaveProperty("path");
      expect(event).toHaveProperty("delete");
      expect(event).toHaveProperty("write");
      expect(event).toHaveProperty("rename");
      expect(event).toHaveProperty("metadata");
      expect(event).toHaveProperty("move_to");
      expect(event).toHaveProperty("changed_files");

      // Validate types
      expect(typeof event.timestamp).toBe("number");
      expect(typeof event.index).toBe("number");
      expect(typeof event.path).toBe("string");
      expect(typeof event.delete).toBe("boolean");
      expect(typeof event.write).toBe("boolean");
      expect(typeof event.rename).toBe("boolean");
      expect(typeof event.metadata).toBe("boolean");
      expect(typeof event.move_to).toBe("boolean");
      expect(Array.isArray(event.changed_files)).toBe(true);
    }
  }
}, 10000);

test("BUN_WATCHER_TRACE with --watch flag", async () => {
  using dir = tempDir("watcher-trace-watch", {
    "script.js": `console.log("run", 0);`,
  });

  const traceFile = join(String(dir), "watch-trace.log");
  const env = { ...bunEnv, BUN_WATCHER_TRACE: traceFile };

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "script.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  let i = 0;
  for await (const line of proc.stdout) {
    const str = new TextDecoder().decode(line);
    if (str.includes(`run ${i}`)) {
      i++;
      if (i === 3) break; // Stop after 3 runs
      await Bun.write(join(String(dir), "script.js"), `console.log("run", ${i});`);
    }
  }

  proc.kill();
  await proc.exited;

  // Check that trace file was created
  expect(existsSync(traceFile)).toBe(true);

  const traceContent = readFileSync(traceFile, "utf-8");
  const lines = traceContent
    .trim()
    .split("\n")
    .filter(l => l.trim());

  // Should have events from watching script.js
  expect(lines.length).toBeGreaterThan(0);

  // Validate JSON structure and find script.js events
  let foundScriptEvent = false;
  for (const line of lines) {
    const event = JSON.parse(line);

    // Check required fields exist
    expect(event).toHaveProperty("timestamp");
    expect(event).toHaveProperty("index");
    expect(event).toHaveProperty("path");
    expect(event).toHaveProperty("delete");
    expect(event).toHaveProperty("write");
    expect(event).toHaveProperty("rename");
    expect(event).toHaveProperty("metadata");
    expect(event).toHaveProperty("move_to");
    expect(event).toHaveProperty("changed_files");

    // Validate types
    expect(typeof event.timestamp).toBe("number");
    expect(typeof event.index).toBe("number");
    expect(typeof event.path).toBe("string");
    expect(typeof event.delete).toBe("boolean");
    expect(typeof event.write).toBe("boolean");
    expect(typeof event.rename).toBe("boolean");
    expect(typeof event.metadata).toBe("boolean");
    expect(typeof event.move_to).toBe("boolean");
    expect(Array.isArray(event.changed_files)).toBe(true);

    if (event.path.includes("script.js") || event.changed_files.some((f: string) => f?.includes("script.js"))) {
      foundScriptEvent = true;
      // Should have write flag set
      expect(event.write).toBe(true);
    }
  }

  expect(foundScriptEvent).toBe(true);
}, 10000);

test("BUN_WATCHER_TRACE with empty path does not create trace", async () => {
  using dir = tempDir("watcher-trace-empty", {
    "test.js": `console.log("ready");`,
  });

  const env = { ...bunEnv, BUN_WATCHER_TRACE: "" };

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "test.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  // Wait for first run, then exit
  for await (const line of proc.stdout) {
    const str = new TextDecoder().decode(line);
    if (str.includes("ready")) {
      break;
    }
  }

  proc.kill();
  await proc.exited;

  // Should not create any trace file in the directory
  const files = Array.from(new Bun.Glob("*.log").scanSync({ cwd: String(dir) }));
  expect(files.length).toBe(0);
});

test("BUN_WATCHER_TRACE appends across reloads", async () => {
  using dir = tempDir("watcher-trace-append", {
    "app.js": `console.log("first-0");`,
  });

  const traceFile = join(String(dir), "append-trace.log");
  const env = { ...bunEnv, BUN_WATCHER_TRACE: traceFile };

  // First run
  const proc1 = Bun.spawn({
    cmd: [bunExe(), "--watch", "app.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  let i = 0;
  for await (const line of proc1.stdout) {
    const str = new TextDecoder().decode(line);
    if (str.includes(`first-${i}`)) {
      i++;
      if (i === 2) break; // Stop after 2 runs
      await Bun.write(join(String(dir), "app.js"), `console.log("first-${i}");`);
    }
  }

  proc1.kill();
  await proc1.exited;

  const firstContent = readFileSync(traceFile, "utf-8");
  const firstLines = firstContent
    .trim()
    .split("\n")
    .filter(l => l.trim());
  expect(firstLines.length).toBeGreaterThan(0);

  // Second run - should append to the same file
  const proc2 = Bun.spawn({
    cmd: [bunExe(), "--watch", "app.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  let j = 0;
  for await (const line of proc2.stdout) {
    const str = new TextDecoder().decode(line);
    if (str.includes(`second-${j}`)) {
      j++;
      if (j === 2) break; // Stop after 2 runs
      await Bun.write(join(String(dir), "app.js"), `console.log("second-${j}");`);
    } else if (str.includes("first-1")) {
      // Initial run, start modifying
      await Bun.write(join(String(dir), "app.js"), `console.log("second-0");`);
    }
  }

  proc2.kill();
  await proc2.exited;

  const secondContent = readFileSync(traceFile, "utf-8");
  const secondLines = secondContent
    .trim()
    .split("\n")
    .filter(l => l.trim());

  // Should have more lines after second run
  expect(secondLines.length).toBeGreaterThan(firstLines.length);

  // All lines should be valid JSON
  for (const line of secondLines) {
    const event = JSON.parse(line);
    expect(event).toHaveProperty("timestamp");
    expect(event).toHaveProperty("path");
  }
}, 10000);
