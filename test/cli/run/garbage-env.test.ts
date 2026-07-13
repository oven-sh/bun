import { describe, expect, test } from "bun:test";
import { bunExe, isPosix } from "harness";
import path from "path";

describe.if(isPosix)("garbage env", () => {
  test("garbage env", async () => {
    const cfile = path.join(import.meta.dirname, "garbage-env.c");
    {
      const cc = Bun.which("clang") || Bun.which("gcc") || Bun.which("cc");
      const { exitCode, stderr } = await Bun.$`${cc} -o garbage-env ${cfile}`;
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
      const bin = path.join(process.cwd(), "garbage-env");
      await Bun.$`binary-sign-tool sign -selfSign 1 -inFile ${bin} -outFile ${bin}.signed && cp ${bin}.signed ${bin} && chmod +x ${bin}`;
    }

    const { exitCode, stderr } = await Bun.$`./garbage-env`.env({ BUN_PATH: bunExe() });
    const stderrText = stderr.toString();
    if (stderrText.length > 0) {
      console.error(stderrText);
    }
    expect(exitCode).toBe(0);
  });
});
