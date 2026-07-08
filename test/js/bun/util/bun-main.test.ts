import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import "../../../harness"; // for expect().toRun()
import { bunEnv, bunExe } from "harness";

describe("Bun.main", () => {
  test("can be overridden", () => {
    expect(Bun.main).toBeString();
    const override = { foo: "bar" };
    // types say Bun.main is a readonly string, but we want to write it
    // and check it can be set to a non-string
    (Bun as any).main = override;
    expect(Bun.main as any).toBe(override);
  });

  test("override is reset when switching to a new test file", () => {
    expect([
      "test",
      join(import.meta.dir, "bun-main-test-fixture-1.ts"),
      join(import.meta.dir, "bun-main-test-fixture-2.ts"),
    ]).toRun();
  });

  // https://github.com/oven-sh/bun/pull/31833
  test("overridden_main is released before VM teardown (BUN_DESTRUCT_VM_ON_EXIT)", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", 'Bun.main = "x"; console.log("ok")'],
      env: { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("ok");
    expect(stderr).not.toContain("AddressSanitizer");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });
});
