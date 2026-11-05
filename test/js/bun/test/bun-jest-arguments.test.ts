import * as runner from "bun:test";
import { expect, test } from "bun:test";

// `Bun.jest` is not part of the public types.
const jestOf = (Bun as unknown as { jest(...args: unknown[]): unknown }).jest;
const path = import.meta.path;

test("Bun.jest(path) is what the file imports from bun:test", () => {
  const module = jestOf(path) as Record<string, unknown>;
  expect(typeof module).toBe("object");
  for (const name of ["test", "expect", "describe", "jest", "vi", "mock", "spyOn", "beforeEach"]) {
    expect(module[name]).toBe((runner as Record<string, unknown>)[name]);
  }
  expect(jestOf(path)).toBe(module);
});

test("whatever the second argument is, Bun.jest(path, x) answers the same module", () => {
  const module = jestOf(path);
  for (const second of [undefined, null, false, true, 0, 1, "", "expect", {}, []]) {
    expect(jestOf(path, second)).toBe(module);
    expect(jestOf(path, second, undefined)).toBe(module);
    expect(jestOf(path, second, false)).toBe(module);
  }
});

test("Bun.jest still refuses what is no absolute path", () => {
  for (const rest of [[], [true], [true, true]]) {
    expect(() => jestOf("relative.js", ...rest)).toThrow("Bun.jest() expects an absolute file path, got 'relative.js'");
    expect(() => jestOf(5, ...rest)).toThrow("Bun.jest() expects a string filename");
  }
});

test("the third argument asks which names of the runner a script had put on globalThis in front of this file", () => {
  expect(jestOf(path, true, true)).toBe(0);
  // It is looked at once, in front of each test file.
  (globalThis as Record<string, unknown>).expect = expect;
  try {
    expect(jestOf(path, true, true)).toBe(0);
  } finally {
    delete (globalThis as Record<string, unknown>).expect;
  }
});
