import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { inspect } from "node:util";

test("inspect(weakSet, { showHidden: true }) shows entries", () => {
  const obj = { a: 1 };
  const obj2 = { b: 2 };
  const weakSet = new WeakSet([obj, obj2]);

  const out = inspect(weakSet, { showHidden: true });
  // Order of entries is not deterministic
  expect(out).toContain("{ a: 1 }");
  expect(out).toContain("{ b: 2 }");
  expect(out).toStartWith("WeakSet {");
  expect(out).toEndWith("}");
});

test("inspect(weakMap, { showHidden: true }) shows entries", () => {
  const obj = { a: 1 };
  const obj2 = { b: 2 };
  const weakMap = new WeakMap([
    [obj, "val1"],
    [obj2, "val2"],
  ]);

  const out = inspect(weakMap, { showHidden: true });
  // Order of entries is not deterministic
  expect(out).toContain("{ a: 1 } => 'val1'");
  expect(out).toContain("{ b: 2 } => 'val2'");
  expect(out).toStartWith("WeakMap {");
  expect(out).toEndWith("}");
});

test("inspect(weakSet) without showHidden shows items unknown", () => {
  const obj = { a: 1 };
  const weakSet = new WeakSet([obj]);

  expect(inspect(weakSet)).toBe("WeakSet { <items unknown> }");
});

test("inspect(weakMap) without showHidden shows items unknown", () => {
  const obj = { a: 1 };
  const weakMap = new WeakMap([[obj, "val1"]]);

  expect(inspect(weakMap)).toBe("WeakMap { <items unknown> }");
});

test("inspect(weakMap, { showHidden: true, maxArrayLength: 0 }) shows remaining count", () => {
  const obj = { a: 1 };
  const obj2 = { b: 2 };
  const weakMap = new WeakMap([
    [obj, "val1"],
    [obj2, "val2"],
  ]);

  expect(inspect(weakMap, { showHidden: true, maxArrayLength: 0 })).toBe("WeakMap { ... 2 more items }");
});

test("inspect(weakSet, { showHidden: true, maxArrayLength: 0 }) shows remaining count", () => {
  const obj = { a: 1 };
  const obj2 = { b: 2 };
  const weakSet = new WeakSet([obj, obj2]);

  expect(inspect(weakSet, { showHidden: true, maxArrayLength: 0 })).toBe("WeakSet { ... 2 more items }");
});

test("console.log(weakSet) shows items unknown", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const weakSet = new WeakSet([{a:1}]); console.log(weakSet);`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("WeakSet { <items unknown> }");
  expect(exitCode).toBe(0);
});

test("console.log(weakMap) shows items unknown", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `const weakMap = new WeakMap([[{a:1}, 'v']]); console.log(weakMap);`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("WeakMap { <items unknown> }");
  expect(exitCode).toBe(0);
});
