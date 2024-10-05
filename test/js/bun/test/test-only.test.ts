import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunExe } from "harness";

test("error-in-beforeAll-1-fixture.js", async () => {
  $.nothrow();
  const result = await $.cwd(import.meta.dir)`${bunExe()} test ./error-in-beforeAll-1-fixture.js`;

  const stderr = result.stderr.toUnixString().split("\n").filter(Boolean).slice(1).join("\n");
  expect(stderr).toContain("Unhandled error between tests");
  expect(stderr).toContain("1 error, causing 1 or more tests to not run");
  expect(result.exitCode).toBe(1);
});

test("error-in-beforeAll-fixture.js", async () => {
  $.nothrow();
  const result = await $.cwd(import.meta.dir)`${bunExe()} test ./error-in-beforeAll-fixture.js`;

  const stderr = result.stderr.toUnixString().split("\n").filter(Boolean).slice(1).join("\n");
  expect(stderr).toContain("Unhandled error between tests");
  expect(stderr).toContain("1 error, causing 2+ tests to not run");
  expect(result.exitCode).toBe(1);
});

test("error-in-beforeEach-fixture-1.js", async () => {
  $.nothrow();
  const result = await $.cwd(import.meta.dir)`${bunExe()} test ./error-in-beforeEach-fixture-1.js`;
  const stderr = result.stderr.toUnixString().split("\n").filter(Boolean).slice(1).join("\n");
  expect(stderr).toContain("Unhandled error between tests");
  expect(stderr).toContain("1 error, causing 1 or more tests to not run");
  expect(result.exitCode).toBe(1);
});

test("error-in-beforeEach-fixture.js", async () => {
  $.nothrow();
  const result = await $.cwd(import.meta.dir)`${bunExe()} test ./error-in-beforeEach-fixture.js`;
  const stderr = result.stderr.toUnixString().split("\n").filter(Boolean).slice(1).join("\n");
  expect(stderr).toContain("Unhandled error between tests");
  expect(stderr).toContain("1 error, causing 2+ tests to not run");
  expect(result.exitCode).toBe(1);
});

test("describe-only-todo-fixture.js", async () => {
  $.nothrow();
  const result = await $.cwd(import.meta.dir)`${bunExe()} test ./describe-only-todo-fixture.js`;

  const stderr = result.stderr.toUnixString().split("\n").filter(Boolean).slice(1);
  expect(stderr).toEqual([
    expect.stringContaining("(pass) Parent describe.only > non-only child describe > test should run"),
    " 1 pass",
    " 0 fail",
    " 1 expect() calls",
    expect.stringContaining("Ran 1 tests across 1 files"),
  ]);
});

test("describe.only + beforeAll", async () => {
  const result = await $.cwd(import.meta.dir)`${bunExe()} test ./describe-only-fixture.js`;

  const stderr = result.stderr.toUnixString().split("\n").filter(Boolean).slice(1);
  expect(stderr).toEqual([
    expect.stringContaining("(pass) desc2 > test2"),
    " 1 pass",
    " 0 fail",
    " 2 expect() calls",
    expect.stringContaining("Ran 1 tests across 1 files"),
  ]);
});

test.each(["./only-fixture-1.ts", "./only-fixture-2.ts", "./only-fixture-3.ts"])(
  `test.only shouldn't need --only for %s`,
  async (file: string) => {
    const result = await $.cwd(import.meta.dir)`${bunExe()} test ${file}`;

    expect(result.stderr.toString()).toContain(" 1 pass\n");
    expect(result.stderr.toString()).toContain(" 0 fail\n");
    expect(result.stderr.toString()).toContain("Ran 1 tests across 1 files");
  },
);

test("only resets per test", async () => {
  const files = ["./only-fixture-1.ts", "./only-fixture-2.ts", "./only-fixture-3.ts", "./only-fixture-4.ts"];
  const result = await $.cwd(import.meta.dir)`${bunExe()} test ${{ raw: files.join(" ") }}`;

  expect(result.stderr.toString()).toContain(" 6 pass\n");
  expect(result.stderr.toString()).toContain(" 0 fail\n");
  expect(result.stderr.toString()).toContain("Ran 6 tests across 4 files");
});
