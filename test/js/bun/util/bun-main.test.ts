import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { bunRun } from "../../../harness"; // for expect().toSpawn()

describe("Bun.main", () => {
  test("can be overridden", () => {
    expect(Bun.main).toBeString();
    const override = { foo: "bar" };
    // types say Bun.main is a readonly string, but we want to write it
    // and check it can be set to a non-string
    (Bun as any).main = override;
    expect(Bun.main as any).toBe(override);
  });

  test.concurrent("override is reset when switching to a new test file", async () => {
    // `bun test` writes its summary to stderr, so check exitCode directly instead of .toSpawn().
    const { stderr, exitCode } = await bunRun([
      "test",
      join(import.meta.dir, "bun-main-test-fixture-1.ts"),
      join(import.meta.dir, "bun-main-test-fixture-2.ts"),
    ]);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
});
