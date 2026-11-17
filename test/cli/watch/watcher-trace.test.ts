import { expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isLinux, tempDir, untilEveryThreadIs } from "harness";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
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

type Batch = { files: Record<string, { events: string[]; changed?: string[] }> };

/**
 * Starts `bun --hot` on `main.js`, which imports the files of `deps`. Each file prints its name and the version of
 * its text. A text is at least 4 lines, and its first lines alone are a program too.
 */
async function hotWithTrace(deps = ["dep.js"]) {
  const text = (name: string, version: string) =>
    (name === "main.js" ? "//\n" + deps.map(dep => `import "./${dep}";\n`).join("") : "//\n//\n//\n") +
    `console.log("${name} ${version}");\n` +
    (name === "main.js" ? "setInterval(() => {}, 1e6);\n" : "");
  const dir = tempDir("watcher-trace-hot", {
    "app/main.js": text("main.js", "v0"),
    ...Object.fromEntries(deps.map(dep => [`app/${dep}`, text(dep, "v0")])),
    "staging/next.js": "",
  });
  const file = (name: string) => join(String(dir), "app", name);
  const next = join(String(dir), "staging", "next.js");
  // The trace file is outside the watched folder, so the watcher does not report its own writes.
  const trace = join(String(dir), "trace.log");
  const proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "--no-clear-screen", "main.js"],
    env: { ...bunEnv, BUN_WATCHER_TRACE: trace },
    cwd: join(String(dir), "app"),
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
  });
  const lines = forEachLine(proc.stdout);
  const seen = new Set<string>();
  /** Resolves when the program has printed `line`, now or before. */
  const printed = async (line: string) => {
    while (!seen.has(line)) {
      const { value, done } = await lines.next();
      if (done) throw new Error(`bun --hot ended before it printed ${JSON.stringify(line)}`);
      seen.add(value);
    }
  };
  await printed("main.js v0");
  let fences = 0;
  return {
    pid: proc.pid,
    file,
    text,
    printed,
    /** The batches that the watcher sent to `--hot`. It logs a batch before it sends it. */
    batches: (): Batch[] =>
      readFileSync(trace, "utf8")
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line)),
    /** A writer that takes its time. A watcher that does not wait for the close sends a batch in these 5 ms. */
    pause() {
      const size = statSync(trace).size;
      const started = performance.now();
      while (statSync(trace).size === size && performance.now() - started < 5) {}
    },
    /**
     * A save by rename of the entry point. The watcher sends it after every batch before it, and `--hot` reloads for
     * it whatever the saves before it did. Its run loads each file as it is then.
     */
    async fence() {
      const version = "fence" + ++fences;
      writeFileSync(next, text("main.js", version));
      renameSync(next, file("main.js"));
      await printed("main.js " + version);
    },
    async [Symbol.asyncDispose]() {
      proc.kill();
      await proc.exited;
      dir[Symbol.dispose]();
    },
  };
}

const writesTo = (batches: Batch[], name: string) =>
  batches.filter(batch =>
    Object.entries(batch.files).some(
      ([path, { events, changed }]) =>
        events.includes("write") && (path.endsWith("/" + name) || changed?.includes(name)),
    ),
  ).length;

// The watcher holds a batch for 50 ms at most. A save that a busy machine made longer than this can be two batches.
const longestSave = 40;

// Only inotify reports that a writer closed a file, so only there can a batch wait for the end of a save.
test.skipIf(!isLinux).each(["main.js", "dep.js"])("--hot gets a save in place of %s as one batch", async name => {
  await using hot = await hotWithTrace();
  const saves = {
    "truncate, write": (fd: number, text: string) => {
      hot.pause();
      writeSync(fd, text);
    },
    "truncate, 4 writes": (fd: number, text: string) => {
      for (const line of text.split(/(?<=\n)/)) {
        hot.pause();
        writeSync(fd, line);
      }
    },
    // The order of `fs.writeFileSync` and `Bun.write`.
    "write, truncate": (fd: number, text: string) => {
      writeSync(fd, text);
      hot.pause();
      ftruncateSync(fd, text.length);
    },
  };
  const batchesPerSave: Record<string, number[]> = {};
  let version = 0;
  for (const [order, save] of Object.entries(saves)) {
    const counts: number[] = (batchesPerSave[order] = []);
    for (let attempt = 0; counts.length < 2 && attempt < 20; attempt++) {
      const from = hot.batches().length;
      const text = hot.text(name, "v" + ++version);
      const started = performance.now();
      const fd = openSync(hot.file(name), order.startsWith("truncate") ? "w" : "r+");
      save(fd, text);
      closeSync(fd);
      const took = performance.now() - started;
      // The fence replaces the entry point, so the run of this save has to come first.
      if (name === "main.js") await hot.printed(`${name} v${version}`);
      await hot.fence();
      await hot.printed(`${name} v${version}`);
      if (took <= longestSave) counts.push(writesTo(hot.batches().slice(from), name));
    }
  }
  expect(batchesPerSave).toEqual({
    "truncate, write": [1, 1],
    "truncate, 4 writes": [1, 1],
    "write, truncate": [1, 1],
  });
});

test.skipIf(!isLinux)("--hot holds a batch until the last of many files is closed", async () => {
  const deps = Array.from({ length: 32 }, (_, i) => `dep${i}.js`);
  const last = deps.length - 1;
  await using hot = await hotWithTrace(deps);
  const counts: number[] = [];
  let version = 0;
  for (let attempt = 0; counts.length < 2 && attempt < 20; attempt++) {
    const from = hot.batches().length;
    version++;
    const started = performance.now();
    const fds = deps.map(dep => openSync(hot.file(dep), "w"));
    hot.pause();
    for (let i = 0; i < last; i++) {
      writeSync(fds[i], hot.text(deps[i], "v" + version));
      closeSync(fds[i]);
    }
    hot.pause();
    writeSync(fds[last], hot.text(deps[last], "v" + version));
    closeSync(fds[last]);
    const took = performance.now() - started;
    await hot.fence();
    await hot.printed(`${deps[last]} v${version}`);
    if (took <= longestSave) counts.push(writesTo(hot.batches().slice(from), deps[last]));
  }
  expect(counts).toEqual([1, 1]);
});

// 32 saves are 128 changes and 32 closes. A batch is 128 events at most, and a close must not count as one.
test.skipIf(!isLinux)("--hot gets 32 queued saves in place as one batch", async () => {
  const deps = Array.from({ length: 32 }, (_, i) => `dep${i}.js`);
  await using hot = await hotWithTrace(deps);
  const from = hot.batches().length;
  process.kill(hot.pid, "SIGSTOP");
  try {
    await untilEveryThreadIs("T", hot.pid);
    for (const dep of deps) {
      const fd = openSync(hot.file(dep), "w");
      writeSync(fd, hot.text(dep, "v1"));
      closeSync(fd);
    }
  } finally {
    process.kill(hot.pid, "SIGCONT");
  }
  await hot.fence();
  await hot.printed("dep31.js v1");
  const saved = hot.batches().slice(from);
  expect(saved.filter(batch => deps.some(dep => writesTo([batch], dep) > 0)).length).toBe(1);
});

test.skipIf(!isLinux)("--hot waits again for the close of a file whose writer closed it late", async () => {
  await using hot = await hotWithTrace();
  const from = hot.batches().length;
  const fd = openSync(hot.file("dep.js"), "a");
  try {
    writeSync(fd, `console.log("dep.js late");\n`);
    // The watcher gives up on the close after 50 ms and sends the write.
    await hot.printed("dep.js late");
  } finally {
    closeSync(fd);
  }
  const counts: number[] = [];
  for (let attempt = 0; counts.length < 1 && attempt < 20; attempt++) {
    const before = hot.batches().length;
    const started = performance.now();
    const again = openSync(hot.file("dep.js"), "w");
    hot.pause();
    writeSync(again, hot.text("dep.js", "v" + attempt));
    closeSync(again);
    const took = performance.now() - started;
    await hot.fence();
    await hot.printed("dep.js v" + attempt);
    if (took <= longestSave) counts.push(writesTo(hot.batches().slice(before), "dep.js"));
  }
  expect(counts).toEqual([1]);
  // The late close is not a batch of its own.
  expect(
    hot
      .batches()
      .slice(from)
      .flatMap(batch => Object.values(batch.files))
      .filter(file => file.events.length === 0),
  ).toEqual([]);
});

test.skipIf(!isLinux)(
  "--hot gets no batch for a file that is opened for writing and closed with no write",
  async () => {
    await using hot = await hotWithTrace();
    const from = hot.batches().length;
    closeSync(openSync(hot.file("dep.js"), "r+"));
    await hot.fence();
    const files = hot
      .batches()
      .slice(from)
      .flatMap(batch => Object.entries(batch.files));
    expect(files.filter(([path, file]) => path.endsWith("/dep.js") || file.events.length === 0)).toEqual([]);
  },
);

// A new file has no watch of its own, so the watcher gets no close for it. Its folder reports the create and the write.
test.todo("--hot gets the first save of a new file as one batch", async () => {
  await using hot = await hotWithTrace();
  const from = hot.batches().length;
  const fd = openSync(hot.file("new.js"), "w");
  hot.pause();
  writeSync(fd, hot.text("new.js", "v1"));
  closeSync(fd);
  await hot.fence();
  const named = hot
    .batches()
    .slice(from)
    .filter(batch => Object.values(batch.files).some(file => file.changed?.includes("new.js")));
  expect(named.length).toBe(1);
});
