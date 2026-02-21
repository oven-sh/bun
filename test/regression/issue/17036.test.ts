import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/17036
// Legacy TypeScript decorator parameter with the same name as an imported
// variable should not shadow the import in the decorator expression.
test("legacy TS decorator parameter does not shadow import", async () => {
  using dir = tempDir("issue-17036", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
      },
    }),
    "token.ts": `export const X = "hello";`,
    "inject.ts": `export function Inject(token: any): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {};
}`,
    // Parameter name X shadows the imported X, but the decorator expression
    // @Inject(X) should still refer to the imported X.
    "index.ts": `import { Inject } from "./inject.ts";
import { X } from "./token.ts";

class ExampleClass {
  constructor(
    @Inject(X) X: string
  ) {}
}

console.log("OK");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(stderr).not.toContain("ReferenceError");
  expect(exitCode).toBe(0);
});

test("legacy TS decorator parameter - multiple params with shadowing", async () => {
  using dir = tempDir("issue-17036-multi", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
      },
    }),
    "tokens.ts": `export const A = "tokenA";
export const B = "tokenB";`,
    "inject.ts": `export function Inject(token: any): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {};
}`,
    "index.ts": `import { Inject } from "./inject.ts";
import { A, B } from "./tokens.ts";

class ExampleClass {
  constructor(
    @Inject(A) A: string,
    @Inject(B) B: string
  ) {}
}

console.log("OK");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(stderr).not.toContain("ReferenceError");
  expect(exitCode).toBe(0);
});

test("legacy TS decorator parameter - non-shadowing still works", async () => {
  using dir = tempDir("issue-17036-noshadow", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
      },
    }),
    "token.ts": `export const X = "hello";`,
    "inject.ts": `export function Inject(token: any): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {};
}`,
    // Parameter name differs from import name - should still work
    "index.ts": `import { Inject } from "./inject.ts";
import { X } from "./token.ts";

class ExampleClass {
  constructor(
    @Inject(X) myParam: string
  ) {}
}

console.log("OK");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("OK\n");
  expect(stderr).not.toContain("ReferenceError");
  expect(exitCode).toBe(0);
});
