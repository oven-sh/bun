import { expect, test } from "bun:test";
import { which } from "bun:internal-for-testing";
import { isWindows } from "harness";

test("which finds executables in PATH", () => {
  // "bun" should always be in PATH during tests
  const bunPath = which("bun");
  expect(bunPath).not.toBe(null);
  expect(bunPath!.length).toBeGreaterThan(0);
});

test("which returns null for non-existent commands", () => {
  const result = which("this-command-definitely-does-not-exist-12345");
  expect(result).toBe(null);
});

if (!isWindows) {
  test("which finds common system utilities", () => {
    // At least one of these should exist on any POSIX system
    const ls = which("ls");
    const cat = which("cat");
    const sh = which("sh");

    const foundAtLeastOne = ls !== null || cat !== null || sh !== null;
    expect(foundAtLeastOne).toBe(true);
  });
}
