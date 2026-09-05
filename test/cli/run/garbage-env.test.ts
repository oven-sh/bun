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

    if (process.platform === "openharmony") {
      // Freshly compiled here via a raw `cc` invocation, so it never goes
      // through bun's own install/build signing pipeline — exec then fails
      // with EACCES/Permission denied.
      const bin = exe;
      await Bun.$`binary-sign-tool sign -selfSign 1 -inFile ${bin} -outFile ${bin}.signed && cp ${bin}.signed ${bin} && chmod +x ${bin}`;
    }

    const { exitCode, stderr } = await Bun.$`${exe}`.env({ BUN_PATH: bunExe() });
    const stderrText = stderr.toString();
    if (stderrText.length > 0) {
      console.error(stderrText);
    }
    expect(exitCode).toBe(0);
  });
});
