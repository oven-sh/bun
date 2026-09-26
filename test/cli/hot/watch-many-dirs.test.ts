import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isASAN, isCI, isLinux, tempDir } from "harness";
import { mkdirSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
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

  // On inotify the watchlist registers paths: it keeps a descriptor for each
  // watched directory but none for a watched file (an open descriptor would pin
  // the inode an atomic save replaces). Each transpile opens the file by path,
  // hands the descriptor to the watcher, and closes it when the watcher
  // declines it, so no file descriptor may stay open after a reload
  // (previously the watchlist kept one per file, and the entrypoint gained one
  // more per reload). /proc/<pid>/fd is Linux-only.
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

      const countFds = () => {
        const counts = { entry: 0, dep: 0, libDir: 0 };
        for (const fd of readdirSync(`/proc/${proc.pid}/fd`)) {
          let target: string;
          try {
            target = readlinkSync(`/proc/${proc.pid}/fd/${fd}`);
          } catch {
            continue;
          }
          if (target === join(dirReal, "entry.js")) counts.entry++;
          else if (target === join(dirReal, "lib", "dep.js")) counts.dep++;
          else if (target === join(dirReal, "lib")) counts.libDir++;
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
      // A transpile closes its descriptor before it hands the module to the JS
      // thread, so once RELOAD is printed nothing for either file may be open.
      // The watch on lib/ holds the directory open; it guards against a
      // vacuous pass if /proc stops being readable or the paths stop matching.
      // (The resolver's directory cache holds lib/ too, so only its presence is
      // checked.)
      const before = countFds();
      expect(before).toEqual({ entry: 0, dep: 0, libDir: before.libDir });
      expect(before.libDir).toBeGreaterThan(0);

      const reloads = 15;
      for (let i = 1; i <= reloads; i++) {
        writeFileSync(join(dir, "lib", "dep.js"), `export const value = ${i};`);
        await waitForReload(i);
      }
      const after = countFds();
      expect(after).toEqual({ entry: 0, dep: 0, libDir: after.libDir });
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
