import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { join } from "path";
import { bunEnv, bunExe, tempDir } from "harness";

describe("bun build --outdir common path stripping", () => {
  for (const count of [2, 7, 8, 9, 10, 16]) {
    test(`${count} entrypoints from same directory produce flat output`, async () => {
      const names = Array.from({ length: count }, (_, i) => `entry${i}`);
      const files: Record<string, string> = {};
      for (const name of names) {
        files[`src/deep/nested/${name}.ts`] = `console.log("${name}");`;
      }

      using dir = tempDir(`outdir-common-${count}`, files);
      const entrypoints = names.map((n) => join(String(dir), "src", "deep", "nested", `${n}.ts`));

      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", ...entrypoints, "--target=bun", "--format=esm", "--outdir", join(String(dir), "out")],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(exitCode).toBe(0);

      const outputFiles = readdirSync(join(String(dir), "out"));
      const expected = names.map((n) => `${n}.js`).sort();
      expect(outputFiles.sort()).toEqual(expected);
    });
  }
});
