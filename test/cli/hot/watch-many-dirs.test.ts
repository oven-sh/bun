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
});
