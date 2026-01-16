import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("console.log should only display own properties", () => {
  test("Object.create with prototype properties should not show inherited properties", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const obj = Object.create({ key: 123 });
        console.log(obj);
        obj.key = 456;
        console.log(obj);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    expect(stderr).toBe("");
    // First line: empty object (no own properties)
    // Second line: object with own property key: 456
    expect(stdout).toContain("{}");
    expect(stdout).toContain("key: 456");
    expect(stdout).not.toContain("key: 123");
    expect(exitCode).toBe(0);
  });

  test("Object.create(null) with own properties should display them", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const obj = Object.create(null);
        obj.foo = "bar";
        console.log(obj);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    expect(stderr).toBe("");
    expect(stdout).toContain("foo:");
    expect(stdout).toContain('"bar"');
    expect(exitCode).toBe(0);
  });

  test("regular object should display own properties normally", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const obj = { a: 1, b: 2 };
        console.log(obj);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    expect(stderr).toBe("");
    expect(stdout).toContain("a: 1");
    expect(stdout).toContain("b: 2");
    expect(exitCode).toBe(0);
  });

  test("class instances should display own properties, not inherited methods", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        class Foo {
          constructor() {
            this.value = 42;
          }
          method() {
            return this.value;
          }
        }
        const foo = new Foo();
        console.log(foo);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    const exitCode = await proc.exited;

    expect(stderr).toBe("");
    expect(stdout).toContain("value: 42");
    // Should not display inherited method as own property
    expect(stdout).not.toMatch(/method:\s*\[Function/);
    expect(exitCode).toBe(0);
  });
});
