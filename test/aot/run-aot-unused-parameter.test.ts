import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { test } from "./supported";

test("bun run --aot does not type-check arguments for unused parameters", async () => {
  const file = join(import.meta.dir, "programs", "calls", "unused-parameters.ts");
  const results = [];
  for (const flags of [[], ["--aot"], ["--debug-aot"]]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", ...flags, file],
      cwd: dirname(file),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    results.push(await Promise.all([proc.stdout.text(), proc.exited]));
  }
  expect(results[1]).toEqual(results[0]);
  expect(results[2]).toEqual(results[0]);
  expect(results[0][0]).toContain('none "text" 7');
});
