import { test, expect, describe, it } from "bun:test";
import "harness";
import path from "node:path";
describe("console.trace leak", () => {
  test("should not leak", async () => {
    expect(["--smol", path.join(import.meta.dir, "console-trace-leak-fixture.js")]).toRun();
    // This is a lot slower in a debug build.
  }, 60_000);
});
