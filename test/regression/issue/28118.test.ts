import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("private field references in class field initializers with decorated accessor", async () => {
  using dir = tempDir("issue-28118", {
    "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
    "test.ts": `
function id(
  value: ClassAccessorDecoratorTarget<any, any>,
  context: ClassAccessorDecoratorContext,
): ClassAccessorDecoratorResult<any, any> {
  return value;
}

class MyClass {
  @id accessor label: string = "";
  #name = "hello";
  #callback = () => this.#name;
  run() { return this.#callback(); }
}

console.log(new MyClass().run());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);
});

test("private field direct reference in initializer with decorated accessor", async () => {
  using dir = tempDir("issue-28118", {
    "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
    "test.ts": `
function id(
  value: ClassAccessorDecoratorTarget<any, any>,
  context: ClassAccessorDecoratorContext,
): ClassAccessorDecoratorResult<any, any> {
  return value;
}

class MyClass {
  @id accessor label: string = "";
  #name = "hello";
  #upper = this.#name.toUpperCase();
  getUpper() { return this.#upper; }
}

console.log(new MyClass().getUpper());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("HELLO");
  expect(exitCode).toBe(0);
});

test("static private field references in initializers with decorated accessor", async () => {
  using dir = tempDir("issue-28118", {
    "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
    "test.ts": `
function id(
  value: ClassAccessorDecoratorTarget<any, any>,
  context: ClassAccessorDecoratorContext,
): ClassAccessorDecoratorResult<any, any> {
  return value;
}

class MyClass {
  @id accessor label: string = "";
  static #name = "hello";
  static #callback = () => MyClass.#name;
  static run() { return MyClass.#callback(); }
}

console.log(MyClass.run());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("hello");
  expect(exitCode).toBe(0);
});

test("chained private field references in initializers with decorated accessor", async () => {
  using dir = tempDir("issue-28118", {
    "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
    "test.ts": `
function id(
  value: ClassAccessorDecoratorTarget<any, any>,
  context: ClassAccessorDecoratorContext,
): ClassAccessorDecoratorResult<any, any> {
  return value;
}

class MyClass {
  @id accessor label: string = "";
  #x = 1;
  #y = this.#x + 1;
  #z = this.#y + 1;
  sum() { return this.#x + this.#y + this.#z; }
}

console.log(new MyClass().sum());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe("6");
  expect(exitCode).toBe(0);
});
