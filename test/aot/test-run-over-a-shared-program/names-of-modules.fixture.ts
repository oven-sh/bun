// @ts-nocheck
import statically from "bun:fs";
import { expect, test } from "bun:test";

function codeOf(run: () => unknown) {
  try {
    return run();
  } catch (error) {
    return error.code;
  }
}

test("bun: in front of the bare name of a Node.js builtin names the builtin", async () => {
  expect(statically).toBe(require("node:fs"));
  expect(require("bun:fs")).toBe(require("node:fs"));
  expect((await import("bun:fs")).default).toBe(require("node:fs"));
  expect((await import("bun:fs/promises")).readFile).toBe(require("node:fs").promises.readFile);
  expect(codeOf(() => require("bun:node:fs"))).toBe("MODULE_NOT_FOUND");
  expect(codeOf(() => require("bun:ws"))).toBe("MODULE_NOT_FOUND");
});

test("require.resolve answers the name of a Node.js builtin as it is asked", () => {
  expect(require.resolve("fs")).toBe("fs");
  expect(require.resolve("fs/promises")).toBe("fs/promises");
  expect(require.resolve("node:fs")).toBe("node:fs");
  expect(require.resolve("bun:fs")).toBe("fs");
  expect(require.resolve("bun:sqlite")).toBe("bun:sqlite");
  expect(require.resolve("ws")).toBe("ws");
});

test("import.meta.resolve answers the name of the builtin", () => {
  expect(import.meta.resolve("fs")).toBe("node:fs");
  expect(import.meta.resolve("node:fs")).toBe("node:fs");
  expect(import.meta.resolve("bun:fs")).toBe("bun:fs");
  expect(import.meta.resolve("bun:sqlite")).toBe("bun:sqlite");
});

test("what is missing is missing for every form", async () => {
  expect(codeOf(() => require("bun:missing"))).toBe("MODULE_NOT_FOUND");
  expect(codeOf(() => require.resolve("bun:missing"))).toBe("MODULE_NOT_FOUND");
  expect(await import("bun:missing").catch(error => error.code)).toBe("ERR_MODULE_NOT_FOUND");
  expect(codeOf(() => require("a-missing-package"))).toBe("MODULE_NOT_FOUND");
  expect(codeOf(() => require.resolve("a-missing-package"))).toBe("MODULE_NOT_FOUND");
  expect(codeOf(() => import.meta.resolve("a-missing-package"))).toBe("ERR_MODULE_NOT_FOUND");
  expect(await import("a-missing-package").catch(error => error.code)).toBe("ERR_MODULE_NOT_FOUND");
});
