import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("mock.module() on non-existent module does not leak across test files", async () => {
  using dir = tempDir("mock-leak-nonexistent", {
    "a.test.ts": `
      import { mock, test, expect } from "bun:test";
      test("mocks a non-existent module", async () => {
        mock.module("ghost-module", () => ({ value: "mocked" }));
        // @ts-expect-error
        const m = await import("ghost-module");
        expect(m.value).toBe("mocked");
      });
    `,
    "b.test.ts": `
      import { test, expect } from "bun:test";
      test("mock from previous file does not leak", () => {
        expect(() => require("ghost-module")).toThrow();
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./a.test.ts", "./b.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;

  expect(output).toContain("mocks a non-existent module");
  expect(output).toContain("mock from previous file does not leak");
  expect(exitCode).toBe(0);
});

test("mock.module() on real builtin does not leak across test files", async () => {
  using dir = tempDir("mock-leak-builtin", {
    "a.test.ts": `
      import { mock, test, expect } from "bun:test";
      test("mocks node:path", async () => {
        mock.module("node:path", () => ({
          join: (...args: string[]) => "mocked-join",
        }));
        const { join } = await import("node:path");
        expect(join("a", "b")).toBe("mocked-join");
      });
    `,
    "b.test.ts": `
      import { join } from "node:path";
      import { test, expect } from "bun:test";
      test("node:path is real again", () => {
        expect(join("a", "b")).not.toBe("mocked-join");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./a.test.ts", "./b.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;

  expect(output).toContain("mocks node:path");
  expect(output).toContain("node:path is real again");
  expect(exitCode).toBe(0);
});

test("mock.restore() clears module mocks within a file", async () => {
  using dir = tempDir("mock-restore-clears", {
    "test.test.ts": `
      import { mock, test, expect } from "bun:test";
      test("restore clears module mocks", async () => {
        mock.module("ephemeral-mod", () => ({ v: 1 }));
        // @ts-expect-error
        expect((await import("ephemeral-mod")).v).toBe(1);
        mock.restore();
        expect(() => require("ephemeral-mod")).toThrow();
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./test.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;

  expect(output).toContain("restore clears module mocks");
  expect(exitCode).toBe(0);
});

test("re-mock after mock.restore() is tracked and cleaned up between files", async () => {
  using dir = tempDir("mock-remock-leak", {
    "a.test.ts": `
      import { mock, test, expect } from "bun:test";
      test("restore then remock", async () => {
        mock.module("remock-mod", () => ({ v: 1 }));
        // @ts-expect-error
        expect((await import("remock-mod")).v).toBe(1);
        mock.restore();
        mock.module("remock-mod", () => ({ v: 2 }));
        // @ts-expect-error
        expect((await import("remock-mod")).v).toBe(2);
      });
    `,
    "b.test.ts": `
      import { test, expect } from "bun:test";
      test("remock does not leak", () => {
        expect(() => require("remock-mod")).toThrow();
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./a.test.ts", "./b.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;

  expect(output).toContain("restore then remock");
  expect(output).toContain("remock does not leak");
  expect(exitCode).toBe(0);
});

test("mock.module() on already-imported module restores namespace on cleanup", async () => {
  using dir = tempDir("mock-inplace-restore", {
    "greeting.ts": `export function greet(name: string) { return "Hello, " + name + "!"; }`,
    "a.test.ts": `
      import { greet } from "./greeting";
      import { mock, test, expect } from "bun:test";
      test("mock after import patches namespace", async () => {
        expect(greet("world")).toBe("Hello, world!");
        mock.module("./greeting", () => ({ greet: () => "MOCKED" }));
        const { greet: g2 } = await import("./greeting");
        expect(g2("world")).toBe("MOCKED");
      });
    `,
    "b.test.ts": `
      import { greet } from "./greeting";
      import { test, expect } from "bun:test";
      test("namespace is restored in next file", () => {
        expect(greet("world")).toBe("Hello, world!");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./a.test.ts", "./b.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;

  expect(output).toContain("mock after import patches namespace");
  expect(output).toContain("namespace is restored in next file");
  expect(exitCode).toBe(0);
});

test("mock.module() on large module (node:fs) does not crash", async () => {
  using dir = tempDir("mock-large-module", {
    "test.test.ts": `
      import { mock, test, expect } from "bun:test";
      test("mock node:fs without crash", async () => {
        mock.module("node:fs", () => ({
          readFileSync: () => "mocked-content",
        }));
        const { readFileSync } = await import("node:fs");
        expect(readFileSync()).toBe("mocked-content");
      });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./test.test.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const output = stdout + stderr;

  expect(output).toContain("mock node:fs without crash");
  expect(exitCode).toBe(0);
});
