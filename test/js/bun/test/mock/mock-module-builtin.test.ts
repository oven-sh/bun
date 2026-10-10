import { expect, mock, test } from "bun:test";
import process from "node:process";

test("mock.module with process.getBuiltinModule(node:os)", () => {
  mock.module("node:os", () => {
    return {
      homedir: () => "/mock/node-os-homedir",
      platform: () => "mockOS",
    };
  });

  const os = process.getBuiltinModule("node:os");
  expect(os).toBeDefined();
  expect(os.homedir()).toBe("/mock/node-os-homedir");
  expect(os.platform()).toBe("mockOS");

  // Bare specifier should also resolve to the mock
  const bareOs = process.getBuiltinModule("os");
  expect(bareOs).toBeDefined();
  expect(bareOs.homedir()).toBe("/mock/node-os-homedir");

  // require() should also see the mock
  const reqOs = require("node:os");
  expect(reqOs.homedir()).toBe("/mock/node-os-homedir");
  const reqBareOs = require("os");
  expect(reqBareOs.homedir()).toBe("/mock/node-os-homedir");
});

test("mock.module with bare specifier process.getBuiltinModule(path)", () => {
  mock.module("path", () => {
    return {
      join: (...args: string[]) => args.join("---"),
    };
  });

  const path = process.getBuiltinModule("path");
  expect(path).toBeDefined();
  expect(path.join("a", "b")).toBe("a---b");

  const prefixedPath = process.getBuiltinModule("node:path");
  expect(prefixedPath).toBeDefined();
  expect(prefixedPath.join("a", "b")).toBe("a---b");

  expect(require("path").join("a", "b")).toBe("a---b");
  expect(require("node:path").join("a", "b")).toBe("a---b");
});

test("process.getBuiltinModule for non-builtin returns undefined", () => {
  expect(process.getBuiltinModule("some-random-non-builtin-module")).toBeUndefined();
  expect(process.getBuiltinModule("")).toBeUndefined();
});

test("process.getBuiltinModule throws on async module mock but import() works", async () => {
  mock.module("node:v8", async () => {
    await Bun.sleep(1);
    return { cachedDataVersionTag: () => 12345 };
  });

  expect(() => {
    process.getBuiltinModule("node:v8");
  }).toThrow(/async/);

  expect(() => {
    require("node:v8");
  }).toThrow(/async/);

  const imported = await import("node:v8");
  expect(imported.cachedDataVersionTag()).toBe(12345);
});

test("process.getBuiltinModule returns same instance on subsequent calls", () => {
  mock.module("node:zlib", () => {
    return {
      constants: { Z_NO_FLUSH: 999 },
    };
  });

  const first = process.getBuiltinModule("node:zlib");
  const second = process.getBuiltinModule("node:zlib");
  const third = process.getBuiltinModule("zlib");
  expect(first).toBe(second);
  expect(first).toBe(third);
});
