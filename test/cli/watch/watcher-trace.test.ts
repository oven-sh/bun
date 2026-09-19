import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isFreeBSD, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type TraceFileEvent = { events: string[]; changed?: string[] };

/**
 * Poll the trace file until some recorded event satisfies `pred`.
 *
 * Polls rather than sleeping a fixed amount: the watcher coalesces events over
 * a short window, so the delay before an event lands is variable.
 */
async function waitForTraceEvent(
  traceFile: string,
  what: string,
  pred: (path: string, event: TraceFileEvent) => boolean,
  // Under the per-test default so this throws with the trace dump attached
  // instead of being cut short by the harness timeout.
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let contents = "";
  while (Date.now() < deadline) {
    if (existsSync(traceFile)) {
      contents = readFileSync(traceFile, "utf-8");
      for (const line of contents.split("\n")) {
        if (!line.trim()) continue;
        let parsed: { files?: Record<string, TraceFileEvent> };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // a partially-flushed final line
        }
        for (const [path, event] of Object.entries(parsed.files ?? {})) {
          if (pred(path, event)) return;
        }
      }
    }
    await Bun.sleep(20);
  }
  throw new Error(`timed out waiting for ${what}\ntrace file contents:\n${contents}`);
}

/** Spawn `bun --watch <entry>` with tracing on and wait for its first run. */
async function spawnTraced(dir: string, entry: string, traceFile: string, ready: string) {
  const proc = Bun.spawn({
    cmd: [bunExe(), "--watch", entry],
    env: { ...bunEnv, BUN_WATCHER_TRACE: traceFile },
    cwd: dir,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  const decoder = new TextDecoder();
  let seen = "";
  for await (const chunk of proc.stdout) {
    seen += decoder.decode(chunk);
    if (seen.includes(ready)) return proc;
  }
  // stdout ended without the readiness line, so the process died during startup.
  // Surface that instead of letting the caller time out on a watcher that was
  // never running.
  const exitCode = await proc.exited;
  throw new Error(`bun --watch exited (code ${exitCode}) before printing ${JSON.stringify(ready)}; stdout: ${seen}`);
}

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

// Bumping mtime without touching contents is a metadata-only change: IN_ATTRIB
// on Linux, NOTE_ATTRIB on kqueue. Both must surface as the `metadata` op.
//
// Skipped on Windows: ReadDirectoryChangesW reports metadata changes as
// FILE_ACTION_MODIFIED, indistinguishable from a content write, so there is no
// separate metadata op to assert on.
test.skipIf(isWindows)("utimes on a watched file records a metadata event", async () => {
  using dir = tempDir("watcher-trace-metadata", {
    "script.js": `console.log("ready");`,
  });
  // Outside the watched tree: a trace file written *inside* it would record its
  // own writes and feed itself.
  using traceDir = tempDir("watcher-trace-metadata-out", {});
  const traceFile = join(String(traceDir), "metadata-trace.log");
  const proc = await spawnTraced(String(dir), "script.js", traceFile, "ready");

  const when = new Date();
  utimesSync(join(String(dir), "script.js"), when, when);

  await waitForTraceEvent(
    traceFile,
    "a metadata event on script.js",
    (path, event) => path.includes("script.js") && event.events.includes("metadata"),
  );

  proc.kill();
  await proc.exited;
});

// A rename inside a watched directory has two halves, and both must be
// reported: the departure as `move_from` (IN_MOVED_FROM /
// FILE_ACTION_RENAMED_OLD_NAME) and the arrival as `move_to`. Without the
// departure the vacated name is never invalidated.
//
// Skipped on kqueue: EVFILT_VNODE reports "this directory changed" with no
// per-entry detail, so there is no departure event to map to move_from.
test.skipIf(isMacOS || isFreeBSD)("renaming inside a watched directory records move_from", async () => {
  using dir = tempDir("watcher-trace-movefrom", {
    "script.js": `console.log("ready");`,
  });
  // See the note in the metadata test: keep the trace out of the watched tree.
  using traceDir = tempDir("watcher-trace-movefrom-out", {});
  const traceFile = join(String(traceDir), "movefrom-trace.log");
  const proc = await spawnTraced(String(dir), "script.js", traceFile, "ready");

  // A sibling that is not itself imported, so it has no per-file watch of its
  // own and can only be observed through the parent directory's watch.
  writeFileSync(join(String(dir), "sibling.js"), "export const x = 1;\n");
  await waitForTraceEvent(
    traceFile,
    "a create event naming sibling.js",
    (_path, event) =>
      event.events.includes("create") && (event.changed ?? []).some(name => name.includes("sibling.js")),
  );

  renameSync(join(String(dir), "sibling.js"), join(String(dir), "renamed.js"));

  await waitForTraceEvent(
    traceFile,
    "a move_from event naming sibling.js",
    (_path, event) =>
      event.events.includes("move_from") && (event.changed ?? []).some(name => name.includes("sibling.js")),
  );

  proc.kill();
  await proc.exited;
});
