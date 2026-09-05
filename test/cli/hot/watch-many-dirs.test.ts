import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isASAN, isCI, isLinux, isWindows, tempDir, tempDirWithFiles } from "harness";
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

  // The Windows watcher gets one record per deleted path and matches it against
  // the deleted file and every watched ancestor directory. The modules below
  // sit under up to 80 watched directories, so two records of the delete burst
  // already overflow the 128-event batch, and a batch is dispatched while the
  // burst is still being matched. Dispatching evicts the deleted files from the
  // watchlist. The matching loop used to keep going with the old length, and
  // the watcher thread died with `panic: index out of bounds`, taking the
  // process with it.
  test.skipIf(!isWindows)("survives a delete burst that spans more than one event batch", async () => {
    const depth = 80;
    const files: Record<string, string> = {};
    const imports: string[] = [];
    for (let level = 1; level <= depth; level++) {
      const subdir = Array(level).fill("d").join("/");
      files[`${subdir}/m.js`] = `export const level = ${level};`;
      imports.push(`import "./${subdir}/m.js";`);
    }
    files["entry.js"] = `${imports.join("\n")}\nconsole.log("LOADED");`;
    // Removed at the end instead of with `using`: if the child crashes, its
    // crash reporter keeps the directory busy for a moment, and the removal
    // error would hide the panic output inside a SuppressedError.
    const dir = tempDirWithFiles("hot-delete-burst", files);

    await using proc = spawn({
      cmd: [bunExe(), "--hot", "entry.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // Drained from the start: the reload that the burst itself queues reports
    // the deleted imports on stderr.
    const stderr = proc.stderr.text();

    const iter = forEachLine(proc.stdout);
    const waitForLine = async (expected: string) => {
      while (true) {
        const { value: line, done } = await iter.next();
        if (done) {
          throw new Error(`--hot exited (code ${await proc.exited}) before printing "${expected}"\n${await stderr}`);
        }
        if (line === expected) return;
      }
    };

    await waitForLine("LOADED");
    rmSync(join(dir, "d"), { recursive: true });
    // Only events raised after the burst prove that the watcher thread is still
    // running.
    for (let i = 1; i <= 2; i++) {
      writeFileSync(join(dir, "entry.js"), `console.log("RELOAD ${i}");`);
      await waitForLine(`RELOAD ${i}`);
    }

    proc.kill();
    await proc.exited;
    rmSync(dir, { recursive: true, force: true });
  });
});
