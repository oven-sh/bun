import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/29553
//
// The `accessor` keyword (TC39 auto-accessors / TS 4.9+) was rejected as a
// syntax error when a project's tsconfig.json had `experimentalDecorators: true`.
// The keyword should be accepted under either decorator mode.

async function runBun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  return await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
}

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

  const [stdout, , exitCode] = await runBun(String(dir), "main.ts");
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

  const [stdout, , exitCode] = await runBun(String(dir), "main.ts");
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

  const [stdout, , exitCode] = await runBun(String(dir), "main.ts");
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

  const [, stderr, exitCode] = await runBun(String(dir), "main.ts");
  expect(stderr).toContain("Cannot mix the `accessor` keyword with `experimentalDecorators: true`");
  expect(exitCode).not.toBe(0);
});
