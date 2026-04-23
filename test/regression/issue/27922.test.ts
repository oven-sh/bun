import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// TC39 standard decorators + TypeScript parameter properties:
// Decorator field initializers must be injected AFTER parameter property
// assignments in the constructor body.

function filterStderr(stderr: string) {
  return stderr
    .split("\n")
    .filter(line => !line.startsWith("WARNING: ASAN"))
    .join("\n")
    .trim();
}

test("decorator field initializers run after TS parameter properties are assigned", async () => {
  using dir = tempDir("issue-27922", {
    "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
    "test.ts": `
      function init(value: undefined, context: ClassFieldDecoratorContext) {
        return function(this: any, initialValue: any) {
          return this.options?.prefix ? this.options.prefix + initialValue : initialValue;
        };
      }

      class Xterm {
        @init
        tokenUrl: string = "default";

        constructor(private options: any) {}
      }

      const x = new Xterm({ prefix: "pfx-" });
      console.log(x.tokenUrl);
      console.log(x.options.prefix);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("pfx-default\npfx-\n");
  expect(filterStderr(stderr)).toBe("");
  expect(exitCode).toBe(0);
});

test("decorator field initializers run after multiple TS parameter properties", async () => {
  using dir = tempDir("issue-27922-multi", {
    "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
    "test.ts": `
      function init(value: undefined, context: ClassFieldDecoratorContext) {
        return function(this: any, initialValue: any) {
          return this.a + this.b + initialValue;
        };
      }

      class Foo {
        @init
        result: number = 10;

        constructor(private a: number, private b: number) {}
      }

      const f = new Foo(1, 2);
      console.log(f.result);
      console.log(f.a);
      console.log(f.b);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("13\n1\n2\n");
  expect(filterStderr(stderr)).toBe("");
  expect(exitCode).toBe(0);
});

test("decorator field initializers with super() and TS parameter properties", async () => {
  using dir = tempDir("issue-27922-super", {
    "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
    "test.ts": `
      function init(value: undefined, context: ClassFieldDecoratorContext) {
        return function(this: any, initialValue: any) {
          return this.options?.tag ? this.options.tag + initialValue : initialValue;
        };
      }

      class Base {
        base = true;
      }

      class Derived extends Base {
        @init
        name: string = "world";

        constructor(private options: any) {
          super();
        }
      }

      const d = new Derived({ tag: "hello-" });
      console.log(d.name);
      console.log(d.base);
      console.log(d.options.tag);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("hello-world\ntrue\nhello-\n");
  expect(filterStderr(stderr)).toBe("");
  expect(exitCode).toBe(0);
});
