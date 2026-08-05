import { describe, expect, test } from "bun:test";
import { bunExe, isPosix, tempDir } from "harness";
import path from "path";

// The kernel accepts duplicate KEY= entries in environ (execve does not dedupe).
// libc getenv() and Node both return the FIRST occurrence. Bun's process.env,
// child env, and env-driven knobs like NODE_TLS_REJECT_UNAUTHORIZED must agree
// with libc, so a later duplicate must not override an earlier one.

const cc = Bun.which("clang") || Bun.which("gcc") || Bun.which("cc");

describe.skipIf(!isPosix || !cc)("duplicate keys in process environ", () => {
  const probeSrc = `
    const cp = require("child_process");
    const childVal = cp.execFileSync("/bin/sh", ["-c", "printf %s \\"$BUN_DUP_KEY\\""], { encoding: "utf8" });
    console.log(JSON.stringify({
      env: process.env.BUN_DUP_KEY,
      child: childVal,
      rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      nodeEnv: process.env.NODE_ENV,
    }));
  `;

  async function buildLauncher(outPath: string) {
    const cfile = path.join(import.meta.dirname, "duplicate-env.c");
    await using proc = Bun.spawn({
      cmd: [cc!, "-o", outPath, cfile],
      stderr: "pipe",
      stdout: "ignore",
    });
    const [ccStderr, ccExit] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (ccExit !== 0) console.error(ccStderr);
    expect(ccExit).toBe(0);
  }

  test.concurrent("process.env and child env resolve to the first occurrence (bun run)", async () => {
    using dir = tempDir("dup-env-run", { "probe.cjs": probeSrc });
    const launcher = path.join(String(dir), "duplicate-env");
    await buildLauncher(launcher);

    await using proc = Bun.spawn({
      cmd: [launcher, bunExe(), path.join(String(dir), "probe.cjs")],
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr.trim()).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      env: "/first",
      child: "/first",
      rejectUnauthorized: "1",
      nodeEnv: "from_first",
    });
    expect(exitCode).toBe(0);
  });

  test.concurrent("first occurrence wins for keys pre-seeded before environ scan (bun test)", async () => {
    // `bun test` seeds NODE_ENV into the env map before reading environ; the
    // first environ value must still win over a later duplicate there too.
    using dir = tempDir("dup-env-test", {
      "probe.test.cjs": `const { test } = require("bun:test");\ntest("probe", () => { ${probeSrc} });`,
    });
    const launcher = path.join(String(dir), "duplicate-env");
    await buildLauncher(launcher);

    await using proc = Bun.spawn({
      cmd: [launcher, bunExe(), "test", path.join(String(dir), "probe.test.cjs")],
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const line = stdout.split("\n").find(l => l.startsWith("{"))!;
    expect(JSON.parse(line)).toEqual({
      env: "/first",
      child: "/first",
      rejectUnauthorized: "1",
      nodeEnv: "from_first",
    });
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
});
