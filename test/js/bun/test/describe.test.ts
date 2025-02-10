import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { rm, writeFile } from "fs/promises";
import { join } from "path";

function add(a: number, b: number) {
  return a + b;
}

let functionBlockRan = false;
let stringBlockRan = false;

describe("blocks should handle both a string or function for the first arg", () => {
  describe(add, () => {
    test("should pass", () => {
      functionBlockRan = true;
      expect(true).toBeTrue();
    });
  });

  describe("also here", () => {
    test("Should also pass", () => {
      stringBlockRan = true;
      expect(true).toBeTrue();
    });
  });

  test("both blocks should have run", () => {
    expect(functionBlockRan).toBeTrue();
    expect(stringBlockRan).toBeTrue();
  });
});

describe("shows function name correctly in test output", () => {
  test("describe block shows function name correctly in test output", async () => {
    const test_dir = tmpdirSync();
    try {
      await writeFile(
        join(test_dir, "describe-test.test.js"),
        `
      import { describe, test, expect } from "bun:test";
  
      function add(a, b) {
        return a + b;
      }
  
      describe(add, () => {
        test("should pass", () => {
          expect(true).toBe(true);
        });
      });
      `,
      );

      const { stdout, stderr } = spawnSync({
        cmd: [bunExe(), "test", "describe-test.test.js"],
        cwd: test_dir,
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });

      const fullOutput = stdout.toString() + stderr.toString();

      expect(fullOutput).toInclude("add > should pass");
      expect(fullOutput).not.toInclude("[object Object] > should pass");
    } finally {
      await rm(test_dir, { force: true, recursive: true });
    }
  });
});
