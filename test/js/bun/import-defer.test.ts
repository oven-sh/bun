import { test, expect, describe } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";

describe("import defer", () => {
  test("should parse import defer syntax", async () => {
    const dir = tempDirWithFiles("import-defer", {
      "utils.js": `
        export const helper = () => "hello";
        export const counter = { value: 0 };
      `,
      "main.js": `
        import defer * as utils from "./utils.js";

        // Module should be loaded but not evaluated yet
        export function getUtils() {
          return utils; // This should trigger evaluation
        }

        export function checkCounter() {
          return utils.counter.value;
        }
      `,
    });

    const { stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const error = await stderr.text();
    const exitCode = await exited;

    expect(exitCode).toBe(0);
    expect(error).toBe("");
  });

  test("should only allow defer with star imports", async () => {
    const dir = tempDirWithFiles("import-defer-error", {
      "utils.js": `export const helper = () => "hello";`,
      "main.js": `
        import defer { helper } from "./utils.js"; // This should be an error
        console.log(helper());
      `,
    });

    const { stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const error = await stderr.text();
    const exitCode = await exited;

    expect(exitCode).toBe(1);
    expect(error).toContain("The 'defer' keyword can only be used with star imports");
  });

  test("should defer module evaluation until property access", async () => {
    const dir = tempDirWithFiles("import-defer-eval", {
      "side-effect.js": `
        console.log("Module evaluated!");
        export const value = 42;
      `,
      "main.js": `
        import defer * as sideEffect from "./side-effect.js";

        console.log("Before access");
        const result = sideEffect.value; // Should trigger evaluation here
        console.log("After access:", result);
      `,
    });

    const { stdout, stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await stdout.text();
    const error = await stderr.text();
    const exitCode = await exited;

    expect(exitCode).toBe(0);
    expect(error).toBe("");

    const lines = output.trim().split("\n");
    expect(lines[0]).toBe("Before access");
    expect(lines[1]).toBe("Module evaluated!");
    expect(lines[2]).toBe("After access: 42");
  });

  test("should not defer modules with top-level await", async () => {
    const dir = tempDirWithFiles("import-defer-await", {
      "async-module.js": `
        await new Promise(resolve => setTimeout(resolve, 1));
        export const value = "async";
      `,
      "main.js": `
        import defer * as asyncModule from "./async-module.js"; // Should this be an error?
        console.log(asyncModule.value);
      `,
    });

    const { stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const error = await stderr.text();
    const exitCode = await exited;

    expect(stderr).not.toBe(""); // TODO: Not sure what the error message should be yet
    expect(exitCode).toBe(1);
  });

  test("should handle re-exports from deferred modules", async () => {
    const dir = tempDirWithFiles("import-defer-reexport", {
      "base.js": `
        export const baseValue = "base";
      `,
      "reexport.js": `
        export { baseValue } from "./base.js";
        export const reexportValue = "reexport";
      `,
      "main.js": `
        import defer * as reexport from "./reexport.js";

        console.log(reexport.baseValue);
        console.log(reexport.reexportValue);
      `,
    });

    const { stdout, stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await stdout.text();
    const error = await stderr.text();
    const exitCode = await exited;

    expect(exitCode).toBe(0);
    expect(error).toBe("");
    expect(output).toContain("base");
    expect(output).toContain("reexport");
  });

  test("should handle circular dependencies with deferred imports", async () => {
    const dir = tempDirWithFiles("import-defer-circular", {
      "a.js": `
        import defer * as b from "./b.js";
        export const aValue = "a";
        export function getB() {
          return b.bValue;
        }
      `,
      "b.js": `
        import defer * as a from "./a.js";
        export const bValue = "b";
        export function getA() {
          return a.aValue;
        }
      `,
      "main.js": `
        import * as a from "./a.js";
        import * as b from "./b.js";

        console.log(a.aValue);
        console.log(b.bValue);
        console.log(a.getB());
        console.log(b.getA());
      `,
    });

    const { stdout, stderr, exited } = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await stdout.text();
    const error = await stderr.text();
    const exitCode = await exited;

    expect(exitCode).toBe(0);
    expect(error).toBe("");

    const lines = output.trim().split("\n");
    expect(lines).toContain("a");
    expect(lines).toContain("b");
  });
});
