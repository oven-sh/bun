import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/12655
// "use strict" in -e eval mode should not cause the code to be treated as
// sloppy-mode CommonJS. Eval sources are always ESM (strict mode).

test('eval with "use strict" should still be strict mode', async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", '"use strict"; let body = 1; body["test"] = "test"; console.log(body);'],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toContain("TypeError");
  expect(exitCode).not.toBe(0);
});

test("eval without use strict should be strict mode (ESM)", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", 'let body = 1; body["test"] = "test"; console.log(body);'],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("");
  expect(stderr).toContain("TypeError");
  expect(exitCode).not.toBe(0);
});

test("eval with use strict still runs valid code correctly", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", '"use strict"; console.log(1 + 2);'],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("3\n");
  expect(exitCode).toBe(0);
});

test("all primitive types throw TypeError on property assignment in eval", async () => {
  const code = `
    const primitives = [1, "hello", true, Symbol("x"), 42n];
    for (const p of primitives) {
      try { p.x = 1; console.log("BUG: " + typeof p); } catch(e) { console.log("OK: " + typeof p); }
    }
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK: number\nOK: string\nOK: boolean\nOK: symbol\nOK: bigint\n");
  expect(exitCode).toBe(0);
});
