import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27335
// The `accessor` keyword should work in TypeScript classes even when
// `experimentalDecorators: true` is set in tsconfig.json.

test("accessor keyword works with experimentalDecorators: true", async () => {
  using dir = tempDir("issue-27335", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
      },
    }),
    "main.ts": `
class Person {
    public accessor name: string = "John";
}

const p = new Person();
console.log(p.name);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("John\n");
  expect(exitCode).toBe(0);
});

test("accessor keyword works with various modifiers and experimentalDecorators", async () => {
  using dir = tempDir("issue-27335-modifiers", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
      },
    }),
    "main.ts": `
class Foo {
    accessor x = 1;
    public accessor y = 2;
    private accessor z = 3;
    static accessor w = 4;

    getZ() { return this.z; }
}

const f = new Foo();
console.log(f.x);
console.log(f.y);
console.log(f.getZ());
console.log(Foo.w);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("1\n2\n3\n4\n");
  expect(exitCode).toBe(0);
});

test("accessor keyword works without experimentalDecorators (standard mode)", async () => {
  using dir = tempDir("issue-27335-standard", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {},
    }),
    "main.ts": `
class Person {
    public accessor name: string = "John";
}

const p = new Person();
console.log(p.name);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("John\n");
  expect(exitCode).toBe(0);
});

test("accessor with experimental decorators on other members", async () => {
  using dir = tempDir("issue-27335-mixed", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        experimentalDecorators: true,
      },
    }),
    "main.ts": `
function log(target: any, key: string) {
    // simple experimental decorator
}

class MyClass {
    @log
    greet() { return "hello"; }

    accessor count: number = 42;
}

const obj = new MyClass();
console.log(obj.greet());
console.log(obj.count);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("hello\n42\n");
  expect(exitCode).toBe(0);
});
