import { spawn } from "bun";
import { dlopen } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isASAN, isCI, isLinux, isWindows, tempDir } from "harness";
import { mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
        const updatePromises = [];

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

  // Evicting a watchlist entry used to close the handle stored in it on POSIX
  // only. On Windows every evicted entry leaked its handle: under --hot a
  // deleted import (the reload then watched it again through a new handle),
  // in the dev server a freed directory watch. This drives the --hot case.
  //
  // A raw handle count is not flat under --hot even without that leak: every
  // directory event busts the resolver's directory cache, which abandons the
  // directory handle the busted entry holds. So both phases below run the same
  // reloads and directory events per cycle and differ only in whether the
  // deleted files are watched. The entry blocks on stdin after every reload, so
  // the file changes of a step all land while no reload can run and then
  // coalesce into one reload per step in both phases. Each cycle evicts `files`
  // entries, so the leak is `files` handles per cycle, far more than the one
  // handle an occasional extra reload would cost.
  //
  // The first assertion guards against a vacuous pass: watching the files again
  // must show up as `files` handles. Once file entries stop holding a handle
  // outside kqueue, re-anchor this on the dev server's directory watches
  // (`DirectoryWatchStore::free_entry`), the evicted entries that still hold one.
  test.skipIf(!isWindows)("evicting watchlist entries closes their handles", async () => {
    const files = 16;
    const cycles = 6;
    const indexes = Array.from({ length: files }, (_, i) => i);
    await using dir = tempDir("hot-evict-handles", {
      "entry.js": `
        import { existsSync, readSync } from "node:fs";
        import { loadDeps, seq } from "./trigger.js";
        // GC helper threads are handles too. Create them before the first sample.
        Bun.gc(true);
        let deps = "skipped";
        if (loadDeps) {
          let sum = 0;
          for (let i = 0; i < ${files}; i++) sum += require("./dep" + i + ".js").value;
          deps = sum;
        } else if (!existsSync("dep0.js")) {
          deps = "deleted";
        }
        console.log("RELOAD", seq, deps);
        // Block until the test has made the next step's file changes.
        readSync(0, new Uint8Array(1));
      `,
      "trigger.js": `export const seq = 0; export const loadDeps = true;`,
      ...Object.fromEntries(indexes.map(i => [`dep${i}.js`, `export const value = 0;`])),
      ...Object.fromEntries(indexes.map(i => [`other${i}.js`, `export const value = 0;`])),
    });
    const root = String(dir);

    const kernel32 = dlopen("kernel32.dll", {
      OpenProcess: { args: ["u32", "i32", "u32"], returns: "ptr" },
      GetProcessHandleCount: { args: ["ptr", "ptr"], returns: "i32" },
      CloseHandle: { args: ["ptr"], returns: "i32" },
    });
    const handleCount = (pid: number) => {
      const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
      const handle = kernel32.symbols.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
      if (!handle) throw new Error(`OpenProcess(${pid}) failed`);
      try {
        const count = new Uint32Array(1);
        if (kernel32.symbols.GetProcessHandleCount(handle, count) === 0) {
          throw new Error("GetProcessHandleCount failed");
        }
        return count[0];
      } finally {
        kernel32.symbols.CloseHandle(handle);
      }
    };

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "entry.js"],
      cwd: root,
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });

    const iter = forEachLine(proc.stdout);
    const waitForLine = async (expected: string) => {
      while (true) {
        const { value: line, done } = await iter.next();
        if (done) throw new Error(`--hot exited before printing "${expected}" (exit ${proc.exitCode})`);
        if (line === expected) return;
      }
    };
    // The entry is blocked on stdin between steps. Unblock it so the reload the
    // step's file changes enqueued runs, then wait for that reload's line.
    const releaseAndWaitFor = async (expected: string) => {
      proc.stdin.write("\n");
      await proc.stdin.flush();
      await waitForLine(expected);
    };
    let seq = 0;
    const writeTrigger = (loadDeps: boolean) => {
      seq++;
      writeFileSync(join(root, "trigger.js"), `export const seq = ${seq}; export const loadDeps = ${loadDeps};`);
    };
    // Deletes and recreates the `victim` files between reloads that do not load
    // the deps, then reloads once more with the deps loaded. Deleting the deps
    // evicts their entries (the same delete events enqueue the "deleted"
    // reload), and the last reload watches the recreated files again. Deleting
    // the never-imported other* files instead raises the same directory events
    // without touching the watchlist, so that step gets its reload from the
    // trigger. Every step is one reload in both phases. Returns how many handles
    // the last reload added: the deps it watches again, plus the same directory
    // handle in both phases.
    const cycle = async (victim: "dep" | "other", value: number) => {
      writeTrigger(false);
      await releaseAndWaitFor(`RELOAD ${seq} skipped`);

      for (const i of indexes) rmSync(join(root, `${victim}${i}.js`));
      if (victim === "dep") {
        await releaseAndWaitFor(`RELOAD ${seq} deleted`);
      } else {
        writeTrigger(false);
        await releaseAndWaitFor(`RELOAD ${seq} skipped`);
      }
      const beforeLoad = handleCount(proc.pid);

      for (const i of indexes) writeFileSync(join(root, `${victim}${i}.js`), `export const value = ${value};`);
      writeTrigger(true);
      await releaseAndWaitFor(`RELOAD ${seq} ${victim === "dep" ? files * value : 0}`);
      return handleCount(proc.pid) - beforeLoad;
    };
    const phase = async (victim: "dep" | "other") => {
      const start = handleCount(proc.pid);
      let addedByLoads = 0;
      for (let i = 1; i <= cycles; i++) addedByLoads += await cycle(victim, i);
      return { growth: handleCount(proc.pid) - start, addedByLoads };
    };

    await waitForLine("RELOAD 0 0");
    for (let i = 1; i <= 2; i++) await cycle("other", i);
    const baseline = await phase("other");
    const evictions = await phase("dep");

    // In the eviction phase the deps are watched again on every cycle, so its
    // loads add `files` handles per cycle that the baseline's loads (the deps
    // stayed watched) do not.
    const rewatched = evictions.addedByLoads - baseline.addedByLoads;
    // Unfixed, every eviction cycle also keeps the `files` handles it evicted,
    // so the phase grows by that much more than the baseline. Fixed, the two
    // phases grow by about the same amount.
    const leaked = evictions.growth - baseline.growth;
    const half = (files * cycles) / 2;
    expect({ baseline, evictions, rewatched, leaked }).toEqual({
      baseline,
      evictions,
      rewatched: Math.max(rewatched, half),
      leaked: Math.min(leaked, half),
    });
  });
});
