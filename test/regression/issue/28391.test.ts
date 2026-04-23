import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bundler handles same-named namespace re-exports across files", async () => {
  using dir = tempDir("issue-28391", {
    "a.ts": `export namespace Foo {
  export const value = 42
}`,
    "b.ts": `import { Foo as S } from "./a"
export namespace Foo {
  export const value = S.value
}
console.log(Foo.value)`,
  });

  // Bundle
  await using bundleProc = Bun.spawn({
    cmd: [bunExe(), "build", "b.ts", "--outdir=dist", "--target=bun"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [, bundleExit] = await Promise.all([bundleProc.stderr.text(), bundleProc.exited]);
  expect(bundleExit).toBe(0);

  // Run bundled output
  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "dist/b.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("42\n");
  expect(exitCode).toBe(0);
});

test("bundler handles same-named namespace with functions across files", async () => {
  using dir = tempDir("issue-28391-fn", {
    "a.ts": `export namespace Bar {
  export function greet() { return "hello" }
}`,
    "b.ts": `import { Bar as X } from "./a"
export namespace Bar {
  export const msg = X.greet()
}
console.log(Bar.msg)`,
  });

  await using bundleProc = Bun.spawn({
    cmd: [bunExe(), "build", "b.ts", "--outdir=dist", "--target=bun"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [, bundleExit] = await Promise.all([bundleProc.stderr.text(), bundleProc.exited]);
  expect(bundleExit).toBe(0);

  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "dist/b.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("hello\n");
  expect(exitCode).toBe(0);
});

test("bundler handles star import with same-named namespace", async () => {
  using dir = tempDir("issue-28391-star", {
    "a.ts": `export namespace Foo {
  export const value = 99
}`,
    "b.ts": `import * as A from "./a"
export namespace Foo {
  export const value = A.Foo.value
}
console.log(Foo.value)`,
  });

  await using bundleProc = Bun.spawn({
    cmd: [bunExe(), "build", "b.ts", "--outdir=dist", "--target=bun"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [, bundleExit] = await Promise.all([bundleProc.stderr.text(), bundleProc.exited]);
  expect(bundleExit).toBe(0);

  await using runProc = Bun.spawn({
    cmd: [bunExe(), "run", "dist/b.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([runProc.stdout.text(), runProc.stderr.text(), runProc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("99\n");
  expect(exitCode).toBe(0);
});
