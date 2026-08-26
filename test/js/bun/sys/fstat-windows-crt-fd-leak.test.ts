import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// On Windows, `bun_sys::fstat` on a HANDLE-backed fd (the result of `openat`,
// which is how `Bun.Image(path)` opens its input) used to convert the HANDLE
// to a CRT fd via `_open_osfhandle` and never release it. The CRT fd table is
// capped at 8192, so a long-running process would drift into EMFILE on
// unrelated file operations.
test.skipIf(!isWindows)("fstat on HANDLE-backed fd does not leak CRT fd slots", async () => {
  using dir = tempDir("fstat-crt-fd-leak", {
    // Not a real image; `.metadata()` rejects with a decode error after the
    // openat + fstat have already run, which is all this test needs.
    "probe.bin": "not an image",
    "child.mjs": `
      import fs from "node:fs";
      const p = process.argv[2];
      // CRT fd table hard limit is 8192 (UCRT default). Exceeding it proves
      // the fstat path no longer burns a slot per call.
      const N = 9000;
      for (let i = 0; i < N; i++) {
        try {
          await new Bun.Image(p).metadata();
        } catch (e) {
          if (e?.code === "EMFILE") {
            console.error("EMFILE at iteration " + i + " syscall=" + e.syscall);
            process.exit(1);
          }
        }
      }
      // CRT fd allocation via node:fs must still work after the loop.
      for (let i = 0; i < 10; i++) {
        const fd = fs.openSync(p, "r");
        const st = fs.fstatSync(fd);
        if (st.size !== 12) throw new Error("wrong size: " + st.size);
        fs.closeSync(fd);
      }
      console.log("ok " + N);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "child.mjs", "probe.bin"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
    stdout: "ok 9000",
    stderr: "",
    exitCode: 0,
  });
});
