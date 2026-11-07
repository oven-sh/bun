import { describe, expect, test } from "bun:test";
import { bunExe, isPosix, tempDir } from "harness";
import path from "path";

describe.if(isPosix)("garbage env", () => {
  test("garbage env", async () => {
    const cfile = path.join(import.meta.dirname, "garbage-env.c");
    // Compile into a temp dir so the binary never lands in the repo root.
    using dir = tempDir("garbage-env", {});
    const exe = path.join(String(dir), "garbage-env");
    {
      const cc = Bun.which("clang") || Bun.which("gcc") || Bun.which("cc");
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
});
