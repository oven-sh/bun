import { expect, test } from "bun:test";
import { execFileSync, execSync } from "child_process";

test("execFileSync error should not have self-referencing cycle", () => {
  try {
    execFileSync("nonexistent_binary_xyz_123");
    expect.unreachable();
  } catch (err: any) {
    // err.error should not be the same object as err (self-referencing cycle)
    expect(err.error).not.toBe(err);
    // JSON.stringify should not throw due to cyclic structure
    expect(() => JSON.stringify(err)).not.toThrow();
  }
});

test("execSync error should not have self-referencing cycle", () => {
  try {
    execSync("nonexistent_binary_xyz_123");
    expect.unreachable();
  } catch (err: any) {
    expect(err.error).not.toBe(err);
    expect(() => JSON.stringify(err)).not.toThrow();
  }
});
