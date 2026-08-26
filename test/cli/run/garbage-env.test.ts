import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";
import path from "path";

const cc = Bun.which("clang") || Bun.which("gcc") || Bun.which("cc");

describe.skipIf(!isPosix || !cc)("garbage env", () => {
  test("garbage env", async () => {
    const cfile = path.join(import.meta.dirname, "garbage-env.c");
    // Compile into a temp dir so the binary never lands in the repo root.
    using dir = tempDir("garbage-env", {});
    const exe = path.join(String(dir), "garbage-env");
    {
      const { exitCode, stderr } = await Bun.$`${cc} -o ${exe} ${cfile}`;
      const stderrText = stderr.toString();
      if (stderrText.length > 0) {
        console.error(stderrText);
      }
      expect(exitCode).toBe(0);
    }

    const { exitCode, stderr } = await Bun.$`${exe}`.env({ BUN_PATH: bunExe() });
    const stderrText = stderr.toString();
    if (stderrText.length > 0) {
      console.error(stderrText);
    }
    expect(exitCode).toBe(0);
  });

  // POSIX environ entries are "name=value". A bare "FOOBAR" with no '=' is
  // malformed; glibc getenv() and Node both ignore it. Bun must not surface it
  // as process.env.FOOBAR === "" nor re-serialize it into children as "FOOBAR=".
  test("environ entry with no '=' is dropped, not fabricated as empty", async () => {
    using dir = tempDir("environ-no-equals", {});
    const src = path.join(import.meta.dirname, "environ-no-equals.c");
    const bin = path.join(String(dir), "environ-no-equals");
    {
      await using compile = Bun.spawn({
        cmd: [cc!, "-O0", "-o", bin, src],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, cerr, ccode] = await Promise.all([compile.stdout.text(), compile.stderr.text(), compile.exited]);
      if (ccode !== 0) console.error(cerr);
      expect(ccode).toBe(0);
    }

    const script = `
      const cp = require("child_process");
      const childEnv = cp.execFileSync("/usr/bin/env", { encoding: "utf8" }).split("\\n").filter(Boolean);
      const hasFabricated = childEnv.some(line => line === "FOOBAR=" || line.startsWith("FOOBAR="));
      console.log(JSON.stringify({
        has: "FOOBAR" in process.env,
        val: process.env.FOOBAR ?? null,
        keys: Object.keys(process.env).sort(),
        childHasFOOBAR: hasFabricated,
      }));
    `;

    await using proc = Bun.spawn({
      cmd: [bin, bunExe(), "-e", script],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(result).toEqual({
      has: false,
      val: null,
      keys: ["BUN_DEBUG_QUIET_LOGS", "NO_COLOR", "PATH"],
      childHasFOOBAR: false,
    });
    expect(exitCode).toBe(0);
  });
});
