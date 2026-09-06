import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";

test("BUN_WATCHER_TRACE creates trace file with watch events", async () => {
  using dir = tempDir("watcher-trace", {
    "script.js": `console.log("ready");`,
  });

  const traceFile = join(String(dir), "trace.log");
  const env = { ...bunEnv, BUN_WATCHER_TRACE: traceFile };

  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", "script.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });

  const decoder = new TextDecoder();
  let wroteModification = false;
  // Wait for the initial run, trigger a change, then wait for the reload
  for await (const chunk of proc.stdout) {
    const str = decoder.decode(chunk);
    if (!wroteModification && str.includes("ready")) {
      wroteModification = true;
      await Bun.write(join(String(dir), "script.js"), `console.log("modified");`);
      continue;
    }
    if (wroteModification && str.includes("modified")) {
      break;
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

  // Should have at least one event
  expect(lines.length).toBeGreaterThan(0);

  // Parse and validate JSON structure
  for (const line of lines) {
    const event = JSON.parse(line);

    // Check required fields exist
    expect(event).toHaveProperty("timestamp");
    expect(event).toHaveProperty("files");

    // Validate types
    expect(typeof event.timestamp).toBe("number");
    expect(typeof event.files).toBe("object");

    // Validate files object structure
    for (const [path, fileEvent] of Object.entries(event.files)) {
      expect(typeof path).toBe("string");
      expect(fileEvent).toHaveProperty("events");
      expect(Array.isArray(fileEvent.events)).toBe(true);
      // "changed" field is optional
      if (fileEvent.changed) {
        expect(Array.isArray(fileEvent.changed)).toBe(true);
      }
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
  for await (const chunk of proc.stdout) {
    const str = new TextDecoder().decode(chunk);
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
    expect(event).toHaveProperty("files");

    // Validate types
    expect(typeof event.timestamp).toBe("number");
    expect(typeof event.files).toBe("object");

    // Check for script.js events
    for (const [path, fileEvent] of Object.entries(event.files)) {
      expect(fileEvent).toHaveProperty("events");
      expect(Array.isArray(fileEvent.events)).toBe(true);

      if (
        path.includes("script.js") ||
        (Array.isArray(fileEvent.changed) && fileEvent.changed.some((f: string) => f?.includes("script.js")))
      ) {
        foundScriptEvent = true;
        // Should have write event
        expect(fileEvent.events).toContain("write");
      }
    }
  }

  expect(foundScriptEvent).toBe(true);
}, 10000);

// Windows needs a privilege to create symlinks, and the inotify path under test is Linux only.
const traceDirKinds: [string, boolean][] = isWindows
  ? [["its real path", false]]
  : [
      ["its real path", false],
      ["a symlink", true],
    ];
describe.each(traceDirKinds)("BUN_WATCHER_TRACE inside the watched directory via %s", (_, viaSymlink) => {
  test("does not trace its own writes", async () => {
    using dir = tempDir("watcher-trace-self", {
      "project/script.js": `console.log("run", 0);\nsetInterval(() => {}, 1000);`,
    });
    const project = join(String(dir), "project");
    let traceDir = project;
    if (viaSymlink) {
      traceDir = join(String(dir), "link");
      symlinkSync(project, traceDir, "dir");
    }

    const traceFile = join(traceDir, "trace.log");
    const env = { ...bunEnv, BUN_WATCHER_TRACE: traceFile };

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", "script.js"],
      env,
      cwd: project,
      stdout: "pipe",
      stderr: "inherit",
      stdin: "ignore",
    });

    // Each reload is one seed event. Every trace write is itself a write
    // event on the directory, so the trace must not report it.
    const decoder = new TextDecoder();
    let stdout = "";
    let i = 0;
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk, { stream: true });
      if (stdout.includes(`run ${i}`)) {
        i++;
        if (i === 3) break;
        await Bun.write(join(project, "script.js"), `console.log("run", ${i});\nsetInterval(() => {}, 1000);`);
      }
    }

    proc.kill();
    await proc.exited;
    expect(i).toBe(3);

    const lines = readFileSync(traceFile, "utf-8")
      .trim()
      .split("\n")
      .filter(l => l.trim());
    expect(lines.length).toBeGreaterThan(0);

    const selfReferences = lines.filter(line => {
      const event = JSON.parse(line);
      return Object.values(event.files).some(
        (fileEvent: any) => Array.isArray(fileEvent.changed) && fileEvent.changed.includes("trace.log"),
      );
    });
    expect(selfReferences.slice(0, 3)).toEqual([]);
    expect(lines.length).toBeLessThan(50);
  });
});

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
  for await (const chunk of proc.stdout) {
    const str = new TextDecoder().decode(chunk);
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
  for await (const chunk of proc1.stdout) {
    const str = new TextDecoder().decode(chunk);
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
  for await (const chunk of proc2.stdout) {
    const str = new TextDecoder().decode(chunk);
    if (str.includes(`second-${j}`)) {
      j++;
      if (j === 2) break; // Stop after 2 runs
      await Bun.write(join(String(dir), "app.js"), `console.log("second-${j}");`);
    } else if (str.includes("first-1")) {
      // Second process starts with previous file content ("first-1"), trigger first modification
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
    expect(event).toHaveProperty("files");
  }
}, 10000);
