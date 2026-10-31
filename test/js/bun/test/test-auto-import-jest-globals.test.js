import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("Jest auto imports", () => {
  expect(true).toBe(true);
  expect(typeof describe).toBe("function");
  expect(typeof it).toBe("function");
  expect(typeof test).toBe("function");
  expect(typeof expect).toBe("function");
  expect(typeof beforeAll).toBe("function");
  expect(typeof beforeEach).toBe("function");
  expect(typeof afterAll).toBe("function");
  expect(typeof afterEach).toBe("function");
});

test("Jest's globals aren't available in every file", async () => {
  const jestGlobals = await import("./jest-doesnt-auto-import.js");

  expect(typeof jestGlobals.describe).toBe("undefined");
  expect(typeof jestGlobals.it).toBe("undefined");
  expect(typeof jestGlobals.test).toBe("undefined");
  expect(typeof jestGlobals.expect).toBe("undefined");
  expect(typeof jestGlobals.beforeAll).toBe("undefined");
  expect(typeof jestGlobals.beforeEach).toBe("undefined");
  expect(typeof jestGlobals.afterAll).toBe("undefined");
  expect(typeof jestGlobals.afterEach).toBe("undefined");
});

test.concurrent.each([
  ["bun:test mock", "ts", 'import { mock } from "bun:test"; const mockTrue = mock(() => true);'],
  ["bun:test test", "js", 'import { test } from "bun:test"; const mockTrue = () => typeof test === "function";'],
  ["bun:test expect", "js", 'import { expect } from "bun:test"; const mockTrue = () => true;'],
  ["bun:test alias", "js", 'import { test as runTest } from "bun:test"; const mockTrue = () => runTest === test;'],
  ["bun:test namespace", "js", 'import * as runner from "bun:test"; const mockTrue = () => runner.test === test;'],
  ["bun:test side effect", "js", 'import "bun:test"; const mockTrue = () => true;'],
  [
    "bun:test CommonJS",
    "cjs",
    'const { mock } = require("bun:test"); const mockTrue = mock(() => true); module.exports = {};',
  ],
  ["@jest/globals", "js", 'import { it } from "@jest/globals"; const mockTrue = () => it === test;'],
  ["vitest", "js", 'import { it } from "vitest"; const mockTrue = () => it === test;'],
  [
    "local bindings",
    "js",
    'import { mock } from "bun:test"; const test = "local"; const mockTrue = mock(() => test === "local");',
    "string",
  ],
])("implicit globals coexist with %s", async (_, extension, setup, testType = "function") => {
  using dir = tempDir("test-partial-import", {
    [`globals.test.${extension}`]: `${setup}
      let hookCalls = 0;
      beforeAll(() => hookCalls++);
      beforeEach(() => hookCalls++);
      afterEach(() => {});
      afterAll(() => {});
      describe("implicit globals", () => {
        it("uses the remaining globals", () => {
          expect(mockTrue()).toBe(true);
          expect(typeof test).toBe(${JSON.stringify(testType)});
          expect(hookCalls).toBe(2);
          expect(typeof expectTypeOf).toBe("function");
          expect(typeof jest.fn).toBe("function");
          expect(typeof vi.fn).toBe("function");
          expect(typeof xit).toBe("function");
          expect(typeof xtest).toBe("function");
          expect(typeof xdescribe).toBe("function");
          console.log("globals available");
        });
      });`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: normalizeBunSnapshot(stdout), exitCode }, stderr).toEqual({
    stdout: "bun test <version> (<revision>)\nglobals available",
    exitCode: 0,
  });
});
