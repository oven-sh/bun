/**
 * Test that Bun.Glob and fs.globSync work correctly on FUSE filesystems
 * where d_type returns DT_UNKNOWN.
 *
 * Related to issue #24007 and PR #18172
 */
import { spawn, type ReadableSubprocess } from "bun";
import { describe, expect, test } from "bun:test";
import { isLinux, tmpdirSync } from "harness";
import fs from "node:fs";
import { join } from "node:path";

describe.skipIf(!isLinux)("glob on a FUSE mount", () => {
  async function withFuseMount<T>(fn: (mountpoint: string) => Promise<T>): Promise<T> {
    // Use tmpdirSync for empty mount point (tempDir requires file tree)
    const mountpoint = tmpdirSync();

    let pythonProcess: ReadableSubprocess | undefined = undefined;
    let result: T;
    let originalError: Error | undefined;
    let cleanupError: Error | undefined;

    try {
      // setup FUSE filesystem (uses fuse-fs.py which returns DT_UNKNOWN)
      pythonProcess = spawn({
        cmd: ["python3", "fuse-fs.py", "-f", mountpoint],
        cwd: __dirname,
        stdout: "pipe",
        stderr: "pipe",
      });

      // wait for mount to be ready, also check if Python process exited early
      let tries = 0;
      while (!fs.existsSync(join(mountpoint, "main.js")) && tries < 250 && pythonProcess.exitCode === null) {
        tries++;
        await Bun.sleep(5);
      }
      if (pythonProcess.exitCode !== null && pythonProcess.exitCode !== 0) {
        throw new Error(`FUSE process exited early with code ${pythonProcess.exitCode}`);
      }
      expect(fs.existsSync(join(mountpoint, "main.js"))).toBeTrue();

      result = await fn(mountpoint);
    } catch (e) {
      originalError = e instanceof Error ? e : new Error(String(e));
    } finally {
      if (pythonProcess) {
        try {
          // unmount
          const umount = spawn({ cmd: ["fusermount", "-u", mountpoint] });
          await umount.exited;
          // wait for graceful exit
          await Promise.race([pythonProcess.exited, Bun.sleep(1000)]);
          expect(pythonProcess.exitCode).toBe(0);
        } catch (e) {
          pythonProcess.kill("SIGKILL");
          console.error("python process errored:", await new Response(pythonProcess.stderr).text());
          // Capture cleanup error but don't throw inside finally
          if (!originalError) {
            cleanupError = e instanceof Error ? e : new Error(String(e));
          }
        }
      }
    }

    // Re-throw errors outside finally block
    if (originalError) {
      throw originalError;
    }
    if (cleanupError) {
      throw cleanupError;
    }

    return result!;
  }

  // Set a long timeout so the test can clean up the filesystem mount itself
  // rather than getting interrupted by timeout (matches run-file-on-fuse.test.ts)
  test("Bun.Glob.scanSync finds files on FUSE mount", async () => {
    await withFuseMount(async mountpoint => {
      const glob = new Bun.Glob("*.js");
      const results = Array.from(glob.scanSync({ cwd: mountpoint }));

      // fuse-fs.py provides main.js and main-symlink.js
      expect(results).toContain("main.js");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  }, 10000);

  test("fs.globSync finds files on FUSE mount", async () => {
    await withFuseMount(async mountpoint => {
      const results = fs.globSync("*.js", { cwd: mountpoint });

      expect(results).toContain("main.js");
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  }, 10000);

  test("fs.readdirSync works on FUSE mount", async () => {
    await withFuseMount(async mountpoint => {
      const results = fs.readdirSync(mountpoint);

      expect(results).toContain("main.js");
      expect(results).toContain("main-symlink.js");
    });
  }, 10000);

  test("fs.readdirSync with withFileTypes returns correct types on FUSE mount", async () => {
    await withFuseMount(async mountpoint => {
      const results = fs.readdirSync(mountpoint, { withFileTypes: true });

      const mainJs = results.find(d => d.name === "main.js");
      expect(mainJs).toBeDefined();
      expect(mainJs!.isFile()).toBe(true);

      const symlink = results.find(d => d.name === "main-symlink.js");
      expect(symlink).toBeDefined();
      expect(symlink!.isSymbolicLink()).toBe(true);
    });
  }, 10000);
});
