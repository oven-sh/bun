import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/18333
// "use strict" in a function with non-simple parameters should be a SyntaxError
// per ECMAScript spec Section 15.2.1.

test("'use strict' in function with default parameter is a SyntaxError", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `function test(a = 5) { 'use strict'; }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("use strict");
  expect(exitCode).not.toBe(0);
});

test("'use strict' in function with rest parameter is a SyntaxError", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `function test(...args) { 'use strict'; }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("use strict");
  expect(exitCode).not.toBe(0);
});

test("'use strict' in function with destructuring parameter is a SyntaxError", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `function test({a, b}) { 'use strict'; }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("use strict");
  expect(exitCode).not.toBe(0);
});

test("'use strict' in arrow function with default parameter is a SyntaxError", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const test = (a = 1) => { 'use strict'; }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("use strict");
  expect(exitCode).not.toBe(0);
});

test("'use strict' in function with array destructuring parameter is a SyntaxError", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `function test([a, b]) { 'use strict'; }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("use strict");
  expect(exitCode).not.toBe(0);
});

test("'use strict' in function with simple parameters is allowed", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `function test(a, b) { 'use strict'; console.log('ok'); }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("'use strict' in function with no parameters is allowed", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `function test() { 'use strict'; console.log('ok'); }`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("'use strict' in method with default parameter is a SyntaxError", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `({ test(a = 5) { 'use strict'; } })`],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("use strict");
  expect(exitCode).not.toBe(0);
});
