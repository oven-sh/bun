import { expect, test } from "bun:test";
import { bunEnv, bunExe, isFreeBSD, isMacOS, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync, truncateSync, utimesSync } from "node:fs";
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
    for (const [path, fileEvent] of Object.entries<any>(event.files)) {
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
    for (const [path, fileEvent] of Object.entries<any>(event.files)) {
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

// inotify and ReadDirectoryChangesW report a truncation as a write. kqueue reports it as a change of
// the file's attributes, as it does for `chmod` and `utimes`.
test("a truncation is a write event, and a change of metadata alone is not", async () => {
  using dir = tempDir("watcher-trace-truncation", {
    "app/main.js": `import "./imported.js";\nconsole.log("end");\n`,
    "app/imported.js": `console.log("run");console.log("tail");`,
  });
  const cwd = join(String(dir), "app");
  const imported = join(cwd, "imported.js");
  // Outside the folder that is watched.
  const traceFile = join(String(dir), "trace.log");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "main.js"],
    env: { ...bunEnv, BUN_WATCHER_TRACE: traceFile },
    cwd,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  const reader = proc.stdout.getReader();
  let stdout = "";
  const printed = async (wanted: string) => {
    while (!stdout.includes(wanted)) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += Buffer.from(value).toString();
    }
  };
  /** The events that the trace has for `imported.js`: its own, and those of its folder that name it (inotify). */
  const events = (): string[] =>
    readFileSync(traceFile, "utf8")
      .split("\n")
      .filter(line => line.trim())
      .flatMap(line => Object.entries<{ events: string[]; changed?: string[] }>(JSON.parse(line).files))
      .filter(([path, file]) => path.endsWith("imported.js") || file.changed?.includes("imported.js"))
      .flatMap(([, file]) => file.events);
  await printed("run\ntail\nend\n");

  // ReadDirectoryChangesW does not tell these from a write.
  if (!isWindows) {
    chmodSync(imported, 0o600);
    utimesSync(imported, new Date(2020, 0, 1), new Date(2020, 0, 1));
    // kqueue reports them, and the watcher has handled them once the trace has them. inotify is
    // not asked for them.
    if (isMacOS || isFreeBSD) while (!events().includes("metadata")) await Bun.sleep(1);
  }

  // The rest of the file is the same, so the reload is for the truncation.
  truncateSync(imported, `console.log("run");`.length);
  await printed("run\nend\n");

  expect(stdout).toBe("run\ntail\nend\nrun\nend\n");
  expect(events()).toContain("write");
});
