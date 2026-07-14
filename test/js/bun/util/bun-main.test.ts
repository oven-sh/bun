import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";
import "../../../harness"; // for expect().toRun()

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
    // Releasing the `Bun.main` Strong after the JSC HandleSet is gone is a UAF
    // in Bun__StrongRef__delete: ASAN aborts the process, so a clean exit is
    // the signal. `stderr` is in the assertion only so a failure shows why.
    expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
