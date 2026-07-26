import { describe, expect, test } from "bun:test";
import { bunExe, isPosix, tempDir } from "harness";
import path from "path";

// The kernel accepts duplicate KEY= entries in environ (execve does not dedupe).
// libc getenv() and Node both return the FIRST occurrence. Bun's process.env,
// child env, and env-driven knobs like NODE_TLS_REJECT_UNAUTHORIZED must agree
// with libc, so a later duplicate must not override an earlier one.
describe.if(isPosix)("duplicate keys in process environ", () => {
  test("process.env and child env resolve to the first occurrence", async () => {
    using dir = tempDir("dup-env", {
      "probe.cjs": `
        const cp = require("child_process");
        const childVal = cp.execFileSync("/bin/sh", ["-c", "printf %s \\"$BUN_DUP_KEY\\""], { encoding: "utf8" });
        console.log(JSON.stringify({
          env: process.env.BUN_DUP_KEY,
          child: childVal,
          rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
        }));
      `,
    });

    const cfile = path.join(import.meta.dirname, "duplicate-env.c");
    const launcher = path.join(String(dir), "duplicate-env");
    {
      const cc = Bun.which("clang") || Bun.which("gcc") || Bun.which("cc");
      await using cc_proc = Bun.spawn({
        cmd: [cc!, "-o", launcher, cfile],
        stderr: "pipe",
        stdout: "pipe",
      });
      const [ccStderr, ccExit] = await Promise.all([cc_proc.stderr.text(), cc_proc.exited]);
      if (ccExit !== 0) console.error(ccStderr);
      expect(ccExit).toBe(0);
    }

    await using proc = Bun.spawn({
      cmd: [launcher, bunExe(), path.join(String(dir), "probe.cjs")],
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stderr.trim()).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      env: "/first",
      child: "/first",
      rejectUnauthorized: "1",
    });
    expect(exitCode).toBe(0);
  });
});
