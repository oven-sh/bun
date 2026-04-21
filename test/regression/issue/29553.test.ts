import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/29553
//
// The `accessor` keyword (TC39 auto-accessors / TS 4.9+) was rejected as a
// syntax error when a project's tsconfig.json had `experimentalDecorators: true`.
// The keyword should be accepted under either decorator mode.

test.concurrent("accessor keyword parses and runs under experimentalDecorators: true", async () => {
  using dir = tempDir("issue-29553-exp", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        strict: true,
        skipLibCheck: true,
      },
    }),
    "test/TEST1.ts": `export class Test1 {
  public accessor computed: number;
  constructor(c: number) {
    this.computed = c;
  }
}
`,
    "test/TEST1.test.ts": `import { test, expect, describe } from "bun:test";
import { Test1 } from "./TEST1";

describe("TEST", () => {
  test("asd", () => {
    const t = new Test1(42);
    expect(t.computed).toBe(42);
  });
});
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./test"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // `bun test` writes most of its output to stderr.
  const combined = stdout + stderr;
  expect(combined).toContain("1 pass");
  expect(combined).not.toContain("Expected");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor with various modifiers under experimentalDecorators: true", async () => {
  using dir = tempDir("issue-29553-modifiers", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: true },
    }),
    "main.ts": `class Foo {
  accessor a = 1;
  public accessor b = 2;
  private accessor c = 3;
  protected accessor d = 4;
  static accessor e = 5;
  readonly accessor f = 6;
  getC() { return this.c; }
  getD() { return this.d; }
}
const f = new Foo();
console.log(f.a, f.b, f.getC(), f.getD(), Foo.e, f.f);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("Expected");
  expect(stdout).toBe("1 2 3 4 5 6\n");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor without tsconfig (TS file, no decorator flags)", async () => {
  using dir = tempDir("issue-29553-plain", {
    "main.ts": `class Foo {
  accessor x: number = 42;
}
console.log(new Foo().x);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("Expected");
  expect(stdout).toBe("42\n");
  expect(exitCode).toBe(0);
});

test.concurrent("accessor still works under standard decorators mode", async () => {
  using dir = tempDir("issue-29553-std", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: false },
    }),
    "main.ts": `function dec(value: any, context: any) {
  console.log("dec", context.name, context.kind);
}
class Foo {
  @dec accessor x: number = 7;
}
console.log(new Foo().x);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).not.toContain("Expected");
  expect(stdout).toBe("dec x accessor\n7\n");
  expect(exitCode).toBe(0);
});

test.concurrent("mixing accessor with experimentalDecorators legacy @dec is a clear error, not silent wrong semantics", async () => {
  using dir = tempDir("issue-29553-mixed", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { experimentalDecorators: true },
    }),
    "main.ts": `function legacyDec(target: any, key: string) {}

class Foo {
  @legacyDec
  doThing() {}

  accessor x: number = 0;
}
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("Cannot mix the `accessor` keyword with `experimentalDecorators: true`");
  expect(exitCode).not.toBe(0);
});
