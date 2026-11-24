import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isFreeBSD, isMacOS, isWindows, tempDir } from "harness";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
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

const head = `console.log("head");`;
const whole = head + `console.log("tail");//`;
const saved = `\nconsole.log("saved");`;

/** `bun --hot` with a trace, after its first load. */
async function hotWithTrace() {
  // One chain of imports, so `imported.js` is the last item of the watchlist.
  const dir = tempDir("watcher-trace-truncation", {
    "app/main.js": `import "./fence/index.js";\nconsole.log("end");`,
    "app/fence/index.js": `import "../importer.js";`,
    "app/importer.js": `import "./imported.js";`,
    "app/imported.js": whole,
  });
  const app = join(String(dir), "app");
  const traceFile = join(String(dir), "trace.log");
  const proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "main.js"],
    env: { ...bunEnv, BUN_WATCHER_TRACE: traceFile },
    cwd: app,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  const reader = proc.stdout.getReader();
  let stdout = "";
  let fences = 0;
  const hot = {
    app,
    /** All that was printed, once it has `wanted` or the process has ended. */
    async stdoutWith(wanted: string) {
      while (!stdout.includes(wanted)) {
        const { value, done } = await reader.read();
        if (done) break;
        stdout += Buffer.from(value).toString();
      }
      return stdout;
    },
    /** What `change` adds to the trace for `imported.js`. inotify also names the file in a record of its folder. */
    async eventsOf(change: (file: string) => void) {
      const from = statSync(traceFile).size;
      change(join(app, "imported.js"));
      // Events are traced in order, so those of `change` are there once this one is.
      mkdirSync(join(app, "fence", String(fences++)));
      while (proc.exitCode === null && proc.signalCode === null) {
        const records = readFileSync(traceFile)
          .toString("utf8", from)
          .split("\n")
          .slice(0, -1)
          .flatMap(line => Object.entries<{ events: string[]; changed?: string[] }>(JSON.parse(line).files));
        if (records.some(([path]) => path.endsWith("/fence/"))) {
          return records
            .filter(([path, { changed }]) => path.endsWith("/imported.js") || changed?.includes("imported.js"))
            .flatMap(([, { events }]) => events);
        }
        await Bun.sleep(1);
      }
      throw new Error("bun --hot ended");
    },
    async [Symbol.asyncDispose]() {
      await proc[Symbol.asyncDispose]();
      dir[Symbol.dispose]();
    },
  };
  await hot.stdoutWith("end\n");
  return hot;
}

// ReadDirectoryChangesW can report a write after a later event.
describe.skipIf(isWindows)("changes without a write()", () => {
  test.each([
    ["shorter", head.length, "head\nend\n"],
    ["longer", whole.length + 1, "head\ntail\nend\n"],
  ])("a truncation to a %s length is a write event", async (_, length, printed) => {
    await using hot = await hotWithTrace();
    expect(await hot.eventsOf(file => truncateSync(file, length))).toContain("write");
    const expected = "head\ntail\nend\n" + printed;
    expect(await hot.stdoutWith(expected)).toStartWith(expected);
  });

  test("a truncation that undoes an append is a write event", async () => {
    await using hot = await hotWithTrace();
    expect(await hot.eventsOf(file => appendFileSync(file, saved))).toContain("write");
    expect(await hot.eventsOf(file => truncateSync(file, whole.length))).toContain("write");
  });

  test("a truncation is a write event after the file has moved in the watchlist", async () => {
    await using hot = await hotWithTrace();
    writeFileSync(join(hot.app, "importer.tmp"), `import "./imported.js";\nconsole.log("replaced");`);
    renameSync(join(hot.app, "importer.tmp"), join(hot.app, "importer.js"));
    expect(await hot.stdoutWith("replaced\n")).toContain("replaced\n");
    expect(await hot.eventsOf(file => truncateSync(file, head.length))).toContain("write");
  });

  // inotify reports every truncation as a write.
  const truncations: [string, (file: string) => void, string][] = [
    ["a truncation to the same length", file => truncateSync(file, whole.length), "head\ntail\n"],
    ["the open(O_TRUNC) of a save", file => closeSync(openSync(file, "w")), ""],
  ];
  test.each<(typeof truncations)[number]>([
    ["chmod", file => chmodSync(file, 0o600), "head\ntail\n"],
    ["utimes", file => utimesSync(file, new Date(2020, 0, 1), new Date(2020, 0, 1)), "head\ntail\n"],
    ...(isMacOS || isFreeBSD ? truncations : []),
  ])("%s is not an event", async (_, change, left) => {
    await using hot = await hotWithTrace();
    expect(await hot.eventsOf(change)).toEqual([]);
    expect(await hot.eventsOf(file => appendFileSync(file, saved))).toContain("write");
    expect(await hot.stdoutWith("saved\nend\n")).toStartWith(`head\ntail\nend\n${left}saved\nend\n`);
  });
});
