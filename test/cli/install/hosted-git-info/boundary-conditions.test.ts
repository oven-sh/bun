import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("hosted-git-info boundary conditions", () => {
  test.each([{ description: "git with pound", dependency: "https://github.com/#" }])(
    "handle $description",
    async ({ description: _, dependency }) => {
      using dir = tempDir("hosted-git-info-empty", {
        "package.json": JSON.stringify({
          name: "test",
          dependencies: {
            dependency,
          },
        }),
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "install"],
        cwd: String(dir),
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stderr] = await Promise.all([proc.stderr.text(), proc.exited]);

      expect(stderr).not.toContain("panic");
    },
  );
});
