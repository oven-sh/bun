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

const inParts = ["--parallel=2"];
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

  // The runner stores the names itself, and the build is given no file in its place. A test finds none. With a second test file the project is the
  // folder that the files of the run share, so the compiled program is asked about every path below it.
  const looksForFilesOfTheRun = `
    import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
    test("one", () => {
      const packages = import.meta.dir + "/node_modules";
      const cache = packages + "/.cache";
      const found = [packages, cache].map(path => existsSync(path));
      console.log(">", "1 finds", found.join(), "beside", readdirSync(import.meta.dir).sort().join());
      // As a tool does that keeps its files there.
      if (!existsSync(cache)) mkdirSync(cache, { recursive: true });
      writeFileSync(cache + "/written.txt", "text");
      console.log(">", "2 wrote", readdirSync(cache).join());
    });
  `;
  const anotherTestFile = `test("two", () => {});`;
  const findsNoFileOfTheRun = {
    lines: ["> 1 finds false,false beside a.test.js,b.test.js", "> 2 wrote written.txt"],
    exitCode: 0,
  };

  test("put no file and no folder into the project", async () => {
    const files = { "a.test.js": looksForFilesOfTheRun, "b.test.js": anotherTestFile };
    expect(await printedBy(files, "--globals=vitest")).toEqual(findsNoFileOfTheRun);
    expect(await printedBy(files, "--globals=vitest", "--aot")).toEqual(findsNoFileOfTheRun);
  });

  const besideFileThatAsksForWindow = {
    "a.test.js": "/** @vitest-environment happy-dom */" + looksForFilesOfTheRun,
    "b.test.js": anotherTestFile,
  };

  test("nor beside a test file that asks for a DOM", async () => {
    expect(await printedBy(besideFileThatAsksForWindow, "--globals=vitest")).toEqual(findsNoFileOfTheRun);
  });

  // For the window of a DOM the build reads a file of its own from memory, node_modules/.cache/bun-test-window.ts, and the program answers for that name.
  test.failing("nor there in a compiled run: the file that stands in for the window is found", async () => {
    expect(await printedBy(besideFileThatAsksForWindow, "--globals=vitest", "--aot")).toEqual(findsNoFileOfTheRun);
  });

  const comparesNames = (name: string) => `
    console.log(">", "${name}", vitest === vi, suite === describe, test === it);
    test("one", () => {});
  `;
  // A name that "bun:test" has too is the one of "vitest".
  const saysWhereNamesComeFrom = (title: string) => `
    const { ofBun, ofVitest } = require("./helper.cjs");
    const names = { test, it, describe, suite, vi, vitest, beforeEach, afterAll };
    const from = name => (names[name] === ofVitest[name] ? "vitest" : names[name] === ofBun[name] ? "bun:test" : "neither");
    console.log(">", "${title}", Object.keys(names).map(name => name + " " + from(name)).join(", "));
    test("${title}", () => {});
  `;
  const all =
    "test vitest, it vitest, describe vitest, suite vitest, vi vitest, vitest vitest, beforeEach vitest, afterAll vitest";
  const builtInParts = {
    "helper.cjs": `module.exports = { ofBun: require("bun:test"), ofVitest: require("vitest") };`,
    "a.test.cjs": saysWhereNamesComeFrom("a"),
    "b.test.cjs": saysWhereNamesComeFrom("b"),
  };

  // A run in parts builds Bun's library anew, so what is asked of one under the flag is asked of one run.
  const underTheFlag = {
    ...builtInParts,
    "equal.test.cjs": comparesNames("equal.test.cjs"),
    "equal.test.js": comparesNames("equal.test.js"),
  };
  let ran: Promise<Awaited<ReturnType<typeof printedBy>>[]> | undefined;
  const inPartsUnderTheFlag = () =>
    (ran ??= Promise.all([
      printedBy(underTheFlag, "--globals=vitest", ...inParts.slice(0, 1)),
      printedBy(underTheFlag, "--globals=vitest", "--aot", ...inParts),
    ]));
  const about = (title: string, { lines, exitCode }: Awaited<ReturnType<typeof printedBy>>) => ({
    lines: lines.filter(line => line.startsWith(`> ${title} `)),
    exitCode,
  });

  test.each(["equal.test.cjs", "equal.test.js"])("two names of one object are equal: %s", async name => {
    const files = { [name]: comparesNames(name) };
    const plain = await printedBy(files, "--globals=vitest");
    expect(plain).toEqual({ lines: [`> ${name} true true true`], exitCode: 0 });
    expect(await printedBy(files, "--globals=vitest", "--aot")).toEqual(plain);
    expect((await inPartsUnderTheFlag()).map(run => about(name, run))).toEqual([plain, plain]);
  });

  test("come from vitest in a run that is built in parts: --globals=vitest", async () => {
    for (const run of await inPartsUnderTheFlag())
      expect([about("a", run), about("b", run)]).toEqual([
        { lines: [`> a ${all}`], exitCode: 0 },
        { lines: [`> b ${all}`], exitCode: 0 },
      ]);
  });

  test(`come from vitest in a run that is built in parts: globals = "vitest"`, async () => {
    const files = { "bunfig.toml": bunfig, ...builtInParts };
    const plain = await printedBy(files, ...inParts.slice(0, 1));
    expect(plain).toEqual({ lines: [`> a ${all}`, `> b ${all}`], exitCode: 0 });
    expect(await printedBy(files, "--aot", ...inParts)).toEqual(plain);
  });
});
