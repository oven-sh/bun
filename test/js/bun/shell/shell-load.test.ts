import { describe, expect, test } from "bun:test";
import { isCI, isWindows } from "harness";
import path from "path";
describe("shell load", () => {
  // windows process spawning is a lot slower
  test.skipIf(isCI && isWindows)(
    "immediate exit",
    () => {
      expect([path.join(import.meta.dir, "./shell-immediate-exit-fixture.js")]).toRun();
    },
    {
      timeout: 1000 * 90,
    },
  );
});
