/**
 * Test that Bun.Glob and fs.globSync work correctly on FUSE filesystems
 * where d_type returns DT_UNKNOWN.
 *
 * Related to issue #24007 and PR #18172
 */
import { spawn, type ReadableSubprocess } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isLinux, tmpdirSync } from "harness";
import fs from "node:fs";
import { join } from "node:path";

describe.skipIf(!isLinux)("glob on a FUSE mount", () => {
  // Mount once for the whole describe block. The first python3/libfuse
  // cold-start on Alpine CI can take several seconds when disk I/O is
  // contended by background container setup, so a per-test mount with a
  // short poll budget is flaky. afterAll always runs (even if beforeAll
  // throws) so cleanup is guaranteed.
  let mountpoint: string;
  let pythonProcess: ReadableSubprocess | undefined;

  beforeAll(async () => {
    // Use tmpdirSync for empty mount point (tempDir requires file tree)
    mountpoint = tmpdirSync();

    pythonProcess = spawn({
      cmd: ["python3", "fuse-fs.py", "-f", mountpoint],
      cwd: __dirname,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Poll until the mount is ready or the python process exits. The
    // bound only guards against a true hang; normal startup is <200ms
    // once the page cache is warm.
    let tries = 0;
    while (!fs.existsSync(join(mountpoint, "main.js")) && tries < 1600 && pythonProcess.exitCode === null) {
      tries++;
      await Bun.sleep(5);
    }
    if (pythonProcess.exitCode !== null && pythonProcess.exitCode !== 0) {
      throw new Error(
        `FUSE process exited early with code ${pythonProcess.exitCode}: ${await pythonProcess.stderr.text()}`,
      );
    }
    expect(fs.existsSync(join(mountpoint, "main.js"))).toBeTrue();
  }, 10000);

  afterAll(async () => {
    if (!pythonProcess) return;
    const umount = spawn({ cmd: ["fusermount", "-u", mountpoint] });
    await umount.exited;
    await Promise.race([pythonProcess.exited, Bun.sleep(1000)]);
    if (pythonProcess.exitCode === null) {
      pythonProcess.kill("SIGKILL");
      console.error("python process errored:", await pythonProcess.stderr.text());
    }
  });

  test("Bun.Glob.scanSync finds files on FUSE mount", () => {
    const glob = new Bun.Glob("*.js");
    const results = Array.from(glob.scanSync({ cwd: mountpoint }));

    // fuse-fs.py provides main.js and main-symlink.js
    expect(results).toContain("main.js");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("fs.globSync finds files on FUSE mount", () => {
    const results = fs.globSync("*.js", { cwd: mountpoint });

    expect(results).toContain("main.js");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("fs.readdirSync works on FUSE mount", () => {
    const results = fs.readdirSync(mountpoint);

    expect(results).toContain("main.js");
    expect(results).toContain("main-symlink.js");
  });

  test("fs.readdirSync with withFileTypes returns correct types on FUSE mount", () => {
    const results = fs.readdirSync(mountpoint, { withFileTypes: true });

    const mainJs = results.find(d => d.name === "main.js");
    expect(mainJs).toBeDefined();
    expect(mainJs!.isFile()).toBe(true);

    const symlink = results.find(d => d.name === "main-symlink.js");
    expect(symlink).toBeDefined();
    expect(symlink!.isSymbolicLink()).toBe(true);
  });
});
