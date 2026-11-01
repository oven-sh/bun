import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const names = ["test", "it", "describe", "beforeAll", "beforeEach", "afterEach", "afterAll"];
const body = `
import * as modules from "./modules";
const of = (name, value) => name + ":" + (["vitest", "bun"].filter(module => modules[module][name] === value).join("+") || "neither");
console.log("SEEN", ${names.map(name => `of("${name}", ${name})`).join(", ")}, typeof jest, typeof xit, typeof suite);
test("test", () => {});`;

const ofVitest = "SEEN " + names.map(name => name + ":vitest").join(" ") + " undefined undefined function";
const ofBun = "SEEN " + names.map(name => name + ":bun").join(" ") + " object function undefined";

test.concurrent.each([
  ["ts", `import { vi } from "vitest";`, ofVitest],
  ["tsx", `import { vi } from "vitest";`, ofVitest],
  ["ts", `import { Mock } from "vitest"; let mock: Mock;`, ofVitest],
  ["ts", `import * as all from "vitest";`, ofVitest],
  ["ts", `import { suite as unused, type Mock } from "vitest";`, ofVitest],
  ["ts", `import { vi } from "vitest"; import { mock } from "bun:test"; mock;`, ofVitest],
  ["ts", `import { vi } from "vitest"; vi.fn();`, ofVitest],
  ["ts", `import type { Mock } from "vitest";`, ofBun],
  ["ts", `import { type Mock } from "vitest";`, ofBun],
  ["ts", `import type * as all from "vitest";`, ofBun],
  ["ts", `import { vi } from "bun:test";`, ofBun],
])("globals.test.%s: %s", async (extension, header, expected) => {
  using dir = tempDir("vitest-unused-import", {
    "package.json": `{ "name": "vitest-unused-import" }`,
    "modules.ts": `import * as vitest from "vitest"; import * as bun from "bun:test"; export { vitest, bun };`,
    [`globals.test.${extension}`]: header + body,
  });
  const seenWith = async (env: Record<string, string>, ...more: string[]) => {
    const { stdout, exitCode } = await run([bunExe(), "test", ...more], String(dir), { ...bunEnv, ...env });
    return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const plain = await seenWith({});
  expect(plain).toEqual({ seen: [expected], exitCode: 0 });
  expect(await seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, "--aot")).toEqual(plain);
  expect(await seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }, "--aot")).toEqual(plain);
});
