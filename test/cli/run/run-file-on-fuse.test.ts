import { ReadableSubprocess, spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tmpdirSync } from "harness";
import fs from "node:fs";
import { join } from "node:path";

describe.skipIf(!isLinux)("running files on a FUSE mount", () => {
  async function doTest(pathOnMount: string): Promise<void> {
    const mountpoint = tmpdirSync();

    let pythonProcess: ReadableSubprocess | undefined = undefined;
    try {
      // setup FUSE filesystem
      pythonProcess = spawn({
        cmd: ["python3", "fuse-fs.py", "-f", mountpoint],
        cwd: __dirname,
        stdout: "pipe",
        stderr: "pipe",
      });

      // wait for it to work
      let tries = 0;
      while (!fs.existsSync(join(mountpoint, pathOnMount)) && tries < 250) {
        tries++;
        await Bun.sleep(5);
      }
      expect(fs.existsSync(join(mountpoint, pathOnMount))).toBeTrue();

      // run bun
      const bun = spawn({
        cmd: [bunExe(), join(mountpoint, pathOnMount)],
        cwd: __dirname,
        stdout: "pipe",
        env: bunEnv,
      });
      await Promise.race([bun.exited, Bun.sleep(1000)]);
      expect(bun.exitCode).toBe(0);
      expect(await new Response(bun.stdout).text()).toBe("hello world\n");
    } finally {
      if (pythonProcess) {
        try {
          // run umount
          const umount = spawn({ cmd: ["fusermount", "-u", mountpoint] });
          await umount.exited;
          // wait for graceful exit
          await Promise.race([pythonProcess.exited, Bun.sleep(1000)]);
          expect(pythonProcess.exitCode).toBe(0);
        } catch (e) {
          pythonProcess.kill("SIGKILL");
          console.error("python process errored:", await new Response(pythonProcess.stderr).text());
          throw e;
        }
      }
    }
  }

  // set a long timeout so it is more likely doTest can clean up the filesystem mount itself
  // rather than getting interrupted by timeout
  test("regular file", () => doTest(join("main.js")), 10000);
  test("symlink", () => doTest(join("main-symlink.js")), 10000);
});
