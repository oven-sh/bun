import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// In plain Bun an ES module that was required has a module object in require.cache, and a mock stores there what its factory gave: the next require() answers that very object,
// with the names that the factory added, and a spy on the namespace object does not reach it. An ES module that was only imported has no such object: require() answers the namespace object.
const library = `export function f(x) { return x + 9; }\nexport const g = 1;\n`;
const say = `const say = (label, ...values) => console.log(label + " | " + values.map(String).join(" "));`;

test("require() of an ES module behind a mock of it", async () => {
  using dir = tempDir("require-behind-a-mock", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    "required.js": library,
    "imported.js": library,
    "late.js": library,
    "required.test.js": `
      import { mock, spyOn, test } from "bun:test";
      import * as lib from "./required.js";
      test("required first", async () => {
        ${say}
        say("before the mock", require("./required.js") === lib, require("./required.js").f === lib.f);
        const given = { ...lib, extra: 1 };
        mock.module("./required.js", () => given);
        const required = require("./required.js");
        say("what the factory gave | the namespace", required === given, required === lib);
        say("keys", Object.keys(required).sort().join());
        say("twice the same", require("./required.js") === required);
        const imported = await import("./required.js");
        say("import(): the namespace | what the factory gave", imported === lib, imported === given);
        spyOn(lib, "f").mockImplementation(() => "fake");
        say("a spy on the namespace", lib.f(1), require("./required.js").f(1), given.f(1), (await import("./required.js")).f(1));
        given.f = () => "stored";
        say("a store into what the factory gave", lib.f(1), require("./required.js").f(1));
        const { f, extra } = require("./required.js");
        say("by a pattern", f(1), extra);
      });`,
    "imported.test.js": `
      import { mock, spyOn, test } from "bun:test";
      import * as lib from "./imported.js";
      test("imported alone", async () => {
        ${say}
        const given = { ...lib, extra: 1 };
        mock.module("./imported.js", () => given);
        const required = require("./imported.js");
        say("imported alone: what the factory gave | the namespace", required === given, required === lib);
        say("imported alone: keys", Object.keys(required).sort().join());
        spyOn(lib, "f").mockImplementation(() => "fake");
        say("imported alone: a spy on the namespace", lib.f(1), require("./imported.js").f(1), given.f(1));
      });`,
    "late.test.js": `
      import { mock, test } from "bun:test";
      test("never loaded", async () => {
        ${say}
        const other = { f: () => "late", g: 2 };
        mock.module("./late.js", () => other);
        const late = require("./late.js");
        say("never loaded: what the factory gave", late === other, late.f(1), Object.keys(late).sort().join());
        const imported = await import("./late.js");
        say("never loaded: import()", imported === other, imported.f(1), require("./late.js") === imported);
      });`,
  });
  const seen = async (env: Record<string, string | undefined>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    // The parts of a run end in any order.
    return {
      exitCode,
      lines: stdout
        .split("\n")
        .filter(line => line.includes(" | "))
        .sort(),
    };
  };
  const plain = await seen(bunEnv);
  expect(plain.exitCode).toBe(0);
  expect(plain.lines.length).toBe(13);
  expect(await seen(bunEnv, "--aot")).toEqual(plain);
  expect(await seen({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot")).toEqual(
    plain,
  );
});
