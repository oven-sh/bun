import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isASAN, isCI, isLinux, isWindows, tempDir } from "harness";
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

describe("--hot with many directories", () => {
  // TODO: fix watcher thread exit handling so the main thread waits for the
  // watcher thread to exit. This causes a crash inside the libc exit() function
  // that triggers in ASAN.
  test.skipIf(isCI && isASAN)(
    "handles 129 directories being updated simultaneously",
    async () => {
      // Create initial test structure
      await using tmpdir = tempDir("hot-many-dirs", {
        "entry.js": `console.log('Initial load');`,
      });

      // Generate 129 directories with files
      const dirCount = 129;
      const maxCount = 3;
      for (let i = 0; i < dirCount; i++) {
        const dirName = `dir-${i.toString().padStart(4, "0")}`;
        const dirPath = join(tmpdir, dirName);
        mkdirSync(dirPath, { recursive: true });

        // Create an index.js in each directory
        writeFileSync(join(dirPath, "index.js"), `export const value${i} = ${i};`);
      }

      // Create main index that imports all directories
      const imports = Array.from({ length: dirCount }, (_, i) => {
        const dirName = `dir-${i.toString().padStart(4, "0")}`;
        return `import * as dir${i} from './${dirName}/index.js';`;
      }).join("\n");

      writeFileSync(
        join(tmpdir, "entry.js"),
        `
${imports}
console.log('Loaded', ${dirCount}, 'directories');
(globalThis.reloaded ??= 0);
if (globalThis.reloaded++ >= ${maxCount}) process.exit(0);
`,
      );

      // Start bun --hot
      await using proc = spawn({
        cmd: [bunExe(), "--hot", "entry.js"],
        cwd: tmpdir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });

      const stdout = proc.stdout;

      const iter = forEachLine(stdout);

      // Wait for initial load
      let { value: line } = await iter.next();
      expect(line).toContain(`Loaded ${dirCount} directories`);

      // Trigger maxCount reload cycles
      let reloadCount = 0;

      for (let cycle = 0; cycle < maxCount; cycle++) {
        // Update all files simultaneously
        const timestamp = Date.now() + cycle;
        const updatePromises: Promise<number>[] = [];

        for (let i = 0; i < dirCount; i++) {
          const dirName = `dir-${i.toString().padStart(4, "0")}`;
          const filePath = join(tmpdir, dirName, "index.js");

          updatePromises.push(
            Bun.write(filePath, `export const value${i} = ${i};\nexport const timestamp${i} = ${timestamp};`),
          );
        }

        // Wait for all updates to complete
        await Promise.all(updatePromises);

        // Wait for reload message
        ({ value: line } = await iter.next());
        expect(line).toContain(`Loaded ${dirCount} directories`);
        reloadCount++;
      }

      // Verify we got maxCount successful reloads
      expect(reloadCount).toBe(maxCount);

      // Wait for the process to exit on its own after maxCount reloads
      const exitCode = await proc.exited;

      // Should exit with 0
      expect(exitCode).toBe(0);
    },
    30000,
  ); // 30 second timeout

  // The watchlist owns one descriptor per watched file, closed only when the
  // entry is evicted or the watcher shuts down. Re-transpiles during a reload
  // open the file by path and must not stack additional descriptors on top of
  // the stored one (previously the entrypoint gained one open fd per reload).
  // /proc/<pid>/fd is Linux-only.
  test.skipIf(!isLinux)(
    "keeps a stable number of file descriptors across reloads",
    async () => {
      await using dir = tempDir("hot-fd-stable", {
        "entry.js": `import { value } from "./lib/dep.js";\nconsole.log("RELOAD", value);`,
        "lib/dep.js": `export const value = 0;`,
      });
      const dirReal = realpathSync(String(dir));

      await using proc = spawn({
        cmd: [bunExe(), "--hot", "entry.js"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });

      const countFileFds = () => {
        const counts = { entry: 0, dep: 0 };
        for (const fd of readdirSync(`/proc/${proc.pid}/fd`)) {
          let target: string;
          try {
            target = readlinkSync(`/proc/${proc.pid}/fd/${fd}`);
          } catch {
            continue;
          }
          if (target === join(dirReal, "entry.js")) counts.entry++;
          else if (target === join(dirReal, "lib", "dep.js")) counts.dep++;
        }
        return counts;
      };

      const iter = forEachLine(proc.stdout);
      const waitForReload = async (value: number) => {
        while (true) {
          const { value: line, done } = await iter.next();
          if (done) throw new Error(`--hot exited before RELOAD ${value} (exit ${proc.exitCode})`);
          if (line === `RELOAD ${value}`) return;
        }
      };

      await waitForReload(0);
      // Warm up so both files reach their steady state in the watchlist (the
      // entrypoint is added fd-less before its first transpile; dep's stored
      // fd settles on its first edited reload).
      for (let i = 1; i <= 2; i++) {
        writeFileSync(join(dir, "lib", "dep.js"), `export const value = ${i};`);
        await waitForReload(i);
      }
      const before = countFileFds();
      // Guard against a vacuous pass: the entrypoint's stored descriptor must
      // be visible in the baseline. (dep's can be transiently closed by a
      // directory-event eviction, so it gets no such guard.)
      expect(before.entry).toBeGreaterThan(0);

      const reloads = 15;
      for (let i = 3; i <= reloads + 2; i++) {
        writeFileSync(join(dir, "lib", "dep.js"), `export const value = ${i};`);
        await waitForReload(i);
      }
      const after = countFileFds();

      // One handle's transient presence between samples is not a leak; a
      // per-reload leak shows up as +reloads.
      expect({
        before,
        after,
        entryDelta: Math.min(after.entry - before.entry, 1),
        depDelta: Math.min(after.dep - before.dep, 1),
      }).toEqual({
        before,
        after,
        entryDelta: after.entry - before.entry,
        depDelta: after.dep - before.dep,
      });
    },
    60000,
  );

  // Editing dep.js raises an inotify event on lib/, which makes the reloader
  // evict dep's watchlist entry; the reload then re-adds it with a fresh heap
  // copy of the path. Eviction used to discard the evicted entry's copy
  // without freeing it, so every edit leaked one path, which LSan reports when
  // the process exits (the same check CI's ASAN lane applies to every test
  // process). logLevel=debug makes the reloader log each eviction, so a reload
  // cycle that stopped evicting cannot pass this vacuously.
  test.skipIf(!isLinux || !isASAN)("evicting watchlist entries does not leak their paths", async () => {
    const edits = 3;
    await using dir = tempDir("hot-evict-leak", {
      "bunfig.toml": `logLevel = "debug"\n`,
      "lib/dep.js": `export const value = 0;`,
      "entry.js": `
        import { value } from "./lib/dep.js";
        console.log("RELOAD", value);
        if (value === ${edits}) process.exit(0);
      `,
    });

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "entry.js"],
      cwd: String(dir),
      env: {
        ...bunEnv,
        // Bun's built-in ASAN defaults turn LSan off. Destructing the VM on exit
        // frees what JS still referenced, so only lost allocations get reported.
        ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=1"].filter(Boolean).join(":"),
        // verbosity=1 makes the exit-time check announce itself on stderr.
        LSAN_OPTIONS: [bunEnv.LSAN_OPTIONS, "verbosity=1"].filter(Boolean).join(":"),
        BUN_DESTRUCT_VM_ON_EXIT: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderrText = proc.stderr.text();

    const iter = forEachLine(proc.stdout);
    const waitForLine = async (expected: string) => {
      while (true) {
        const { value: line, done } = await iter.next();
        if (done) throw new Error(`--hot exited before printing "${expected}" (exit ${proc.exitCode})`);
        if (line === expected) return;
      }
    };

    await waitForLine("RELOAD 0");
    for (let i = 1; i <= edits; i++) {
      writeFileSync(join(dir, "lib", "dep.js"), `export const value = ${i};`);
      await waitForLine(`RELOAD ${i}`);
    }
    const [stderr, exitCode] = await Promise.all([stderrText, proc.exited]);

    // One edit can produce more than one directory event, so this is a lower bound.
    const evictions = stderr.split("\n").filter(line => line.includes("Removing file:")).length;
    expect(evictions).toBeGreaterThanOrEqual(edits);
    expect(stderr).toContain("LeakSanitizer: checking for leaks");
    // LSan prints one blank-line-separated block per leaking allocation stack
    // (each naming its allocation site) and then fails the exit.
    const leaks = stderr.split(/\n\s*\n/).filter(block => /^(?:Direct|Indirect) leak of /.test(block));
    expect(leaks).toEqual([]);
    expect({ exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: 0, signalCode: null });
  });
});

// The position of a watchlist entry was a u16. A change to the entry at
// position 65,535 aborted the process with "index out of bounds: the len is 0
// but the index is 0" when no entry before it changed in the same batch, and a
// change to a later entry aborted it with "TryFromIntError(PosOverflow)". An
// eviction of the entry at 65,535 was dropped.
//
// Windows: its watcher takes only paths inside the project root, and this
// fixture keeps its files outside of it, so that one write is one event.
test.skipIf(isWindows)("--hot delivers changes to watchlist entries at position 65,535 and past it", async () => {
  const positions = [8, 65_534, 65_535, 65_536];
  using dir = tempDir("hot-watchlist-index", {
    ...Object.fromEntries(positions.map(position => [`f/${position}.file`, "a"])),
    "proj/late.cjs": "module.exports = 0;",
    "proj/entry.cjs": `
      const { readFileSync } = require("node:fs");
      const { padWatchlistForTesting } = require("bun:internal-for-testing");

      // On the first load, inert entries fill the watchlist up to "position",
      // so the entry of "path" gets exactly that position. A later load adds
      // the entry again when an eviction removed it.
      const watch = (position, path) => {
        if (!globalThis.loaded && padWatchlistForTesting(position) !== position) {
          throw new Error("watchlist position " + position + " is taken");
        }
        return require(path);
      };
      const files = ${JSON.stringify(positions)}.map(position =>
        readFileSync(watch(position, "../f/" + position + ".file"), "utf8"),
      );
      const late = watch(65_544, "./late.cjs");
      globalThis.loaded = true;
      console.log(JSON.stringify({ files, late, length: padWatchlistForTesting(0) }));
    `,
  });
  const proj = join(String(dir), "proj");
  const late = join(proj, "late.cjs");
  const at = (position: number) => join(String(dir), "f", `${position}.file`);
  const trace = join(String(dir), "trace.jsonl");

  await using proc = spawn({
    cmd: [bunExe(), "--hot", "entry.cjs"],
    cwd: proj,
    env: { ...bunEnv, BUN_WATCHER_TRACE: trace },
    stdout: "pipe",
    stderr: "inherit",
  });

  // What the fixture prints on each load. The length shows that every file
  // above has an entry of its own at the position in its name.
  const state = { files: positions.map(() => "a"), late: 0, length: 65_545 };
  const lines = forEachLine(proc.stdout);
  const loaded = async () => {
    const expected = JSON.stringify(state);
    while (true) {
      const { value: line, done } = await lines.next();
      if (done) {
        const exitCode = await proc.exited;
        throw new Error(`--hot exited before it printed ${expected} (exit ${proc.signalCode ?? exitCode})`);
      }
      if (line === expected) return;
    }
  };
  /** One write(2) and no truncate: the file gets one modify event. */
  const overwrite = async (position: number, text: string) => {
    const fd = openSync(at(position), "r+");
    try {
      writeSync(fd, text, 0);
    } finally {
      closeSync(fd);
    }
    state.files[positions.indexOf(position)] = text;
    await loaded();
  };
  /** What a save by rename does: the path gets a new inode. */
  const replace = (path: string, text: string) => {
    const replacement = join(String(dir), "replacement");
    writeFileSync(replacement, text);
    renameSync(replacement, path);
  };
  /** The path of the watchlist entry that each event went to. */
  const traced = () =>
    readFileSync(trace, "utf8")
      .split("\n")
      .filter(line => line.length > 0)
      .map(line => JSON.parse(line).files);

  await loaded();

  for (const position of positions.slice(1)) await overwrite(position, "b");
  expect(traced()).toEqual(positions.slice(1).map(position => ({ [at(position)]: { events: ["write"] } })));

  // "late" is a transpiled module, so its entry holds a descriptor. When a
  // save replaces the file, the reloader evicts the entry by its position,
  // 65,544, and the load adds a new one.
  replace(late, "module.exports = 1;");
  state.late = 1;
  await loaded();
  if (isLinux) {
    const descriptors = readdirSync(`/proc/${proc.pid}/fd`).flatMap(fd => {
      try {
        return [readlinkSync(`/proc/${proc.pid}/fd/${fd}`)];
      } catch {
        return [];
      }
    });
    expect({ replaced: descriptors.includes(`${late} (deleted)`), current: descriptors.includes(late) }).toEqual({
      replaced: false,
      current: true,
    });
  }
  // 65,544 % 65,536 is 8. That entry must keep its watch.
  await overwrite(8, "b");

  // The entry at 65,535 holds no descriptor on Linux. A save that replaces the
  // file is a delete event for that entry, which evicts it. The load adds a
  // new entry, and only that one has a watch on the new inode.
  replace(at(65_535), "c");
  state.files[positions.indexOf(65_535)] = "c";
  await loaded();
  await overwrite(65_535, "d");

  if (isLinux) {
    expect(traced().slice(positions.length - 1)).toEqual([
      { [proj + "/"]: { events: ["move_to"], changed: ["late.cjs"] } },
      { [at(8)]: { events: ["write"] } },
      { [at(65_535)]: { events: ["delete"] } },
      { [at(65_535)]: { events: ["write"] } },
    ]);
  }
  expect({ exitCode: proc.exitCode, signalCode: proc.signalCode }).toEqual({ exitCode: null, signalCode: null });
});
