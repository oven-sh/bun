import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Row 4295. With `--globals=vitest` the runner stores the names of "vitest" on `globalThis` before any file runs, and no file of the run spells that.
async function printedBy(files: Record<string, string>, ...flags: string[]) {
  using directory = tempDir("aot-vitest-globals", files);
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(directory), bunEnv);
  const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("> "));
  return { lines: lines.sort(), exitCode };
}

const inParts = ["--parallel=2", "--aot-memory-limit=1KB"];
const bunfig = `[test]\nglobals = "vitest"\n`;

describe.concurrent("the globals of vitest", () => {
  test("are properties of globalThis", async () => {
    const files = {
      "library.js": `
        const { beforeAll, afterEach } = globalThis;
        console.log(">", "library", typeof beforeAll, typeof afterEach, "suite" in globalThis);
        export const loaded = true;
      `,
      "a.test.js": `
        test("one", async () => console.log(">", "test", typeof globalThis.describe, (await import("./library.js")).loaded));
      `,
    };
    const plain = await printedBy(files, "--globals=vitest");
    expect(plain).toEqual({ lines: ["> library function function true", "> test function true"], exitCode: 0 });
    expect(await printedBy(files, "--globals=vitest", "--aot")).toEqual(plain);
  });

  test("one that a preload has set is kept, and the others are there", async () => {
    const files = {
      "setup.js": `globalThis.suite = "mine";`,
      "a.test.js": `test("one", () => console.log(">", globalThis.suite, typeof globalThis.describe));`,
    };
    const flags = ["--globals=vitest", "--preload=./setup.js"];
    const plain = await printedBy(files, ...flags);
    expect(plain).toEqual({ lines: ["> mine function"], exitCode: 0 });
    expect(await printedBy(files, ...flags, "--aot")).toEqual(plain);
  });

  test.each(["a.test.cjs", "a.test.js"])("two names of one object are equal: %s", async name => {
    const files = {
      [name]: `
        console.log(">", vitest === vi, suite === describe, test === it);
        test("one", () => {});
      `,
    };
    const plain = await printedBy(files, "--globals=vitest");
    expect(plain).toEqual({ lines: ["> true true true"], exitCode: 0 });
    expect(await printedBy(files, "--globals=vitest", "--aot")).toEqual(plain);
    expect(
      await printedBy({ ...files, "b.test.js": `test("two", () => {});` }, "--globals=vitest", "--aot", ...inParts),
    ).toEqual(plain);
  });

  // A name that "bun:test" has too is the one of "vitest".
  test.each([
    ["--globals=vitest", {}, ["--globals=vitest"]],
    [`globals = "vitest"`, { "bunfig.toml": bunfig }, []],
  ] as const)("come from vitest in a run that is built in parts: %s", async (_, config, flags) => {
    const file = (title: string) => `
      const { ofBun, ofVitest } = require("./helper.cjs");
      const names = { test, it, describe, suite, vi, vitest, beforeEach, afterAll };
      const from = name => (names[name] === ofVitest[name] ? "vitest" : names[name] === ofBun[name] ? "bun:test" : "neither");
      console.log(">", "${title}", Object.keys(names).map(name => name + " " + from(name)).join(", "));
      test("${title}", () => {});
    `;
    const files = {
      ...config,
      "helper.cjs": `module.exports = { ofBun: require("bun:test"), ofVitest: require("vitest") };`,
      "a.test.cjs": file("a"),
      "b.test.cjs": file("b"),
    };
    const all =
      "test vitest, it vitest, describe vitest, suite vitest, vi vitest, vitest vitest, beforeEach vitest, afterAll vitest";
    const plain = await printedBy(files, ...flags, ...inParts.slice(0, 1));
    expect(plain).toEqual({ lines: [`> a ${all}`, `> b ${all}`], exitCode: 0 });
    expect(await printedBy(files, ...flags, "--aot", ...inParts)).toEqual(plain);
  });
});
