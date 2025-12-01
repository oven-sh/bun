import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("when beforeEach callback throws", () => {
  test("test name is not garbled", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "test", "./err-in-hook-and-multiple-tests.ts"],
      cwd: import.meta.dir,
      env: bunEnv,
      stdio: [null, "pipe", "pipe"],
    });
    await proc.exited;
    expect(proc.exitCode).toBe(1);
    let err = await new Response(proc.stderr).text();
    // delete working directory and timing info from the actual output since that is unstable
    // and normalize paths to forward slash
    // the important part is not printing some gibberish in place of the second "test 1"
    err = err
      .replaceAll(import.meta.dir, "")
      .replaceAll(/ \[[\d\.]+ms\]/g, "")
      .replaceAll("\\", "/");
    expect(err).toBe(`
err-in-hook-and-multiple-tests.ts:
1 | import { beforeEach, test } from "bun:test";
2 | 
3 | beforeEach(() => {
4 |   throw new Error("beforeEach");
                                  ^
error: beforeEach
      at <anonymous> (/err-in-hook-and-multiple-tests.ts:4:31)
(fail) test 0
1 | import { beforeEach, test } from "bun:test";
2 | 
3 | beforeEach(() => {
4 |   throw new Error("beforeEach");
                                  ^
error: beforeEach
      at <anonymous> (/err-in-hook-and-multiple-tests.ts:4:31)
(fail) test 1

 0 pass
 2 fail
Ran 2 tests across 1 file.
`);
  });

  test("times reported are reasonable", async () => {
    const start = Date.now();
    const proc = Bun.spawn({
      cmd: [bunExe(), "test", "./err-and-sleep-in-hook.ts"],
      cwd: import.meta.dir,
      env: bunEnv,
      stdio: [null, "pipe", "pipe"],
    });
    await proc.exited;
    const elapsed = Date.now() - start;
    expect(proc.exitCode).toBe(1);
    let err = await new Response(proc.stderr).text();
    const matches = [...err.matchAll(/\[([\d\.]+)ms\]/g)];
    // 1 for test 0, 1 for the total
    expect(matches.length).toBe(2);
    for (const match of matches) {
      const ms = parseFloat(match[1]);
      expect(ms).toBeGreaterThan(45); // should have slept for at least 50 ms
      expect(ms).toBeLessThan(2 * elapsed); // should not report a time vastly higher than what it actually took
    }
  });
});
