import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "node:path";

for (const mode of ["plugin", "override"]) {
  for (const spelling of isWindows ? ["dot", "forward"] : ["dot"]) {
    test(`${mode} alias preserves the prepared ESM key with ${spelling} separators`, async () => {
      using dir = tempDir("resolved-module-key", {});
      await using child = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "plugin-resolved-key-fixture.cjs"), mode, spelling, String(dir)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
    });
  }
}
