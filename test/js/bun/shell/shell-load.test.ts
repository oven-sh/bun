import { describe, expect, test } from "bun:test";
import { bunRun } from "harness";
import path from "path";
describe("shell load", () => {
  // windows process spawning is a lot slower
  test.concurrent(
    "immediate exit",
    async () => {
      const { stderr, exitCode } = await bunRun(path.join(import.meta.dir, "./shell-immediate-exit-fixture.js"));
      if (exitCode !== 0) console.error(stderr);
      expect(exitCode).toBe(0);
    },
    {
      timeout: 1000 * 90,
    },
  );
});
