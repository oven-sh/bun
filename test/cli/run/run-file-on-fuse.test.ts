import { type ReadableSubprocess, spawn } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tmpdirSync } from "harness";
import fs from "node:fs";
import { join } from "node:path";

describe.skipIf(!isLinux)("running files on a FUSE mount", () => {
  // Mount once for the whole describe block. The first python3/libfuse
  // cold-start on Alpine CI can take several seconds when disk I/O is
  // contended by background container setup, so a per-test mount with a
  // short poll budget is flaky. afterAll always runs (even if beforeAll
  // throws) so cleanup is guaranteed.
  let mountpoint: string;
  let pythonProcess: ReadableSubprocess | undefined;

  beforeAll(async () => {
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

  async function doTest(pathOnMount: string): Promise<void> {
    const bun = spawn({
      cmd: [bunExe(), join(mountpoint, pathOnMount)],
      cwd: __dirname,
      stdout: "pipe",
      env: bunEnv,
    });
    await Promise.race([bun.exited, Bun.sleep(1000)]);
    expect(bun.exitCode).toBe(0);
    expect(await new Response(bun.stdout).text()).toBe("hello world\n");
  }

  test("regular file", () => doTest("main.js"));
  test("symlink", () => doTest("main-symlink.js"));
});
