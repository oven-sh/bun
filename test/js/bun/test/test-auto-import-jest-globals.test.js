import { bunEnv, bunExe, tempDir } from "harness";

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

describe("partial bun:test import keeps the un-imported jest globals", () => {
  const body = `{
  expect(typeof test).toBe("function");
  expect(typeof describe).toBe("function");
  expect(typeof expect).toBe("function");
  expect(typeof beforeAll).toBe("function");
  expect(typeof beforeEach).toBe("function");
  expect(typeof afterAll).toBe("function");
  expect(typeof afterEach).toBe("function");
  expect(typeof jest).toBe("object");
  expect(typeof vi).toBe("object");
  expect(typeof xit).toBe("function");
  expect(typeof xtest).toBe("function");
  expect(typeof xdescribe).toBe("function");
  expect(typeof expectTypeOf).toBe("function");
  expect(typeof it).toBe("function");
});`;

  const cases = {
    "import { it } from bun:test": `import { it } from "bun:test";\nit("globals", () => ${body}`,
    "import { mock } from bun:test": `import { mock } from "bun:test";\nexpect(typeof mock).toBe("function");\nit("globals", () => ${body}`,
    "import { it } from @jest/globals": `import { it } from "@jest/globals";\nit("globals", () => ${body}`,
    "import { it } from vitest": `import { it } from "vitest";\nit("globals", () => ${body}`,
    "import * as t from bun:test": `import * as t from "bun:test";\nt.it("globals", () => ${body}`,
    "const { it } = require(bun:test)": `const { it } = require("bun:test");\nit("globals", () => ${body}`,
  };

  for (const [name, source] of Object.entries(cases)) {
    test.concurrent(name, async () => {
      using dir = tempDir("jest-globals-partial-import", {
        "partial.test.js": source,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", "partial.test.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("1 pass");
      expect(stderr).toContain("0 fail");
      expect(stderr).not.toContain("error:");
      expect(exitCode).toBe(0);
    });
  }

  test.concurrent("imported name is not double-injected", async () => {
    using dir = tempDir("jest-globals-no-double-inject", {
      "partial.test.js": `import { it, describe } from "bun:test";
describe("d", () => {
  it("t", () => {
    expect(typeof test).toBe("function");
  });
});`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "partial.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("1 pass");
    expect(stderr).not.toContain("has already been declared");
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
  });
});
