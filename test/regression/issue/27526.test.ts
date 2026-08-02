import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/27526
test("legacy decorators work when experimentalDecorators and emitDecoratorMetadata are set", async () => {
  using dir = tempDir("issue-27526", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2021",
        module: "commonjs",
        strict: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
      },
    }),
    "index.ts": `
function MyDecorator(target: any, key: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = function(...args: any[]) {
    return "decorated:" + original.apply(this, args);
  };
}

class Foo {
  @MyDecorator
  hello() {
    return "world";
  }
}

console.log(new Foo().hello());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("decorated:world");
  expect(exitCode).toBe(0);
});

// When neither emitDecoratorMetadata nor experimentalDecorators is set,
// TypeScript files should use TC39 standard decorators.
test("TC39 standard decorators work when neither emitDecoratorMetadata nor experimentalDecorators is set", async () => {
  using dir = tempDir("issue-27526-standard", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "ES2021",
        module: "commonjs",
        strict: true,
      },
    }),
    "index.ts": `
function MyDecorator(value: Function, context: ClassMethodDecoratorContext) {
  return function(this: any, ...args: any[]) {
    return "decorated:" + (value as any).apply(this, args);
  };
}

class Foo {
  @MyDecorator
  hello() {
    return "world";
  }
}

console.log(new Foo().hello());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("decorated:world");
  expect(exitCode).toBe(0);
});
