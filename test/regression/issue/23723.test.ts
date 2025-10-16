import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("issue #23723 - should not crash on string comparisons during optimization", async () => {
  // This test ensures that string comparisons work correctly even when
  // strings might have different encodings during AST optimization

  const code = `
    // String comparisons that trigger optimization
    const a = "hello" < "world";
    const b = "abc" > "xyz";
    const c = "test" <= "test";
    const d = "foo" >= "bar";

    // typeof optimization that was in the stack trace
    const checkUndef = typeof x !== 'undefined';

    // Number comparisons
    const e = 1 < 2;
    const f = 3 > 2;

    console.log("SUCCESS");
  `;

  const result = Bun.spawnSync({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("SUCCESS");
});

test("issue #23723 - string order comparison with unicode", async () => {
  const code = `
    // Unicode string comparisons
    const a = "café" < "résumé";
    const b = "日本" > "中国";
    const c = "🎉" < "🎊";

    // Mixed ASCII and unicode
    const d = "hello" < "café";

    console.log("UNICODE_SUCCESS");
  `;

  const result = Bun.spawnSync({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("UNICODE_SUCCESS");
});
