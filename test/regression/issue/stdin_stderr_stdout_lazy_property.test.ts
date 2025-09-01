import { expect, test } from "bun:test";

test("Bun.stdin, stderr, stdout are LazyProperty instances (same object on multiple access)", () => {
  // Test that multiple accesses return the same object instance
  const stdin1 = Bun.stdin;
  const stdin2 = Bun.stdin;
  expect(stdin1).toBe(stdin2);

  const stderr1 = Bun.stderr;
  const stderr2 = Bun.stderr;
  expect(stderr1).toBe(stderr2);

  const stdout1 = Bun.stdout;
  const stdout2 = Bun.stdout;
  expect(stdout1).toBe(stdout2);
});

test("Bun.stdin, stderr, stdout are valid Blob instances", () => {
  expect(Bun.stdin).toBeInstanceOf(Blob);
  expect(Bun.stderr).toBeInstanceOf(Blob);
  expect(Bun.stdout).toBeInstanceOf(Blob);

  // Test they have expected properties
  expect(typeof Bun.stdin.size).toBe("number");
  expect(typeof Bun.stderr.size).toBe("number");
  expect(typeof Bun.stdout.size).toBe("number");

  expect(typeof Bun.stdin.type).toBe("string");
  expect(typeof Bun.stderr.type).toBe("string");
  expect(typeof Bun.stdout.type).toBe("string");
});

test("stdin, stderr, stdout objects are different from each other", () => {
  expect(Bun.stdin).not.toBe(Bun.stderr);
  expect(Bun.stdin).not.toBe(Bun.stdout);
  expect(Bun.stderr).not.toBe(Bun.stdout);
});
