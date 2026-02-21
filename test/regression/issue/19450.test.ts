import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("parameter properties referenced in class field initializers", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
class Foo {
  constructor(public readonly bar: { foo: string }) {}
  baz = this.bar.foo;
}
const f = new Foo({ foo: "bar" });
console.log(f.baz);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("bar");
  expect(exitCode).toBe(0);
});

test("parameter properties with simple field initializer", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
class Foo {
  constructor(public x: number) {}
  y = this.x + 1;
}
const f = new Foo(5);
console.log(f.y);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("6");
  expect(exitCode).toBe(0);
});

test("parameter properties with multiple fields and ordering", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
class Foo {
  constructor(public a: number, public b: string) {}
  c = this.a * 2;
  d = this.b.toUpperCase();
}
const f = new Foo(3, "hello");
console.log(f.c, f.d);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("6 HELLO");
  expect(exitCode).toBe(0);
});

test("parameter properties with field initializer and extends", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
class Base {
  constructor(public id: number) {}
}
class Child extends Base {
  constructor(public name: string) {
    super(42);
  }
  greeting = "Hello, " + this.name;
}
const c = new Child("world");
console.log(c.greeting, c.id);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("Hello, world 42");
  expect(exitCode).toBe(0);
});

test("parameter properties: static fields should NOT be moved", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
class Foo {
  constructor(public x: number) {}
  static defaultX = 10;
  y = this.x + 1;
}
console.log(Foo.defaultX, new Foo(5).y);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("10 6");
  expect(exitCode).toBe(0);
});

test("parameter properties: field with no initializer stays as class field", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
class Foo {
  constructor(public x: number) {}
  y: number | undefined;
  z = this.x + 1;
}
const f = new Foo(5);
console.log(f.y, f.z);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("undefined 6");
  expect(exitCode).toBe(0);
});

test("parameter properties: field initializer not referencing this still works", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
class Foo {
  constructor(public x: number) {}
  y = 42;
  z = this.x + this.y;
}
const f = new Foo(5);
console.log(f.y, f.z);
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("42 47");
  expect(exitCode).toBe(0);
});
