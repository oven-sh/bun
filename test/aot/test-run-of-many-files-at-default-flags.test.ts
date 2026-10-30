import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

// How `bun test --aot` builds a run differs by its size, by flags and by platform: several programs where the test files reach
// much source and run in workers and the engine loads one program above another, one program elsewhere. Whichever it builds, it
// has to load, and a test file sees of the files before it what it sees under plain `bun test`.
test("a run that reaches much source answers as plain, with no word", async () => {
  const names = Array.from({ length: 17 }, (_, index) => `t${String(index).padStart(2, "0")}`);
  using dir = tempDir("aot-test-run-of-many-files", {
    "node_modules/doubles/package.json": JSON.stringify({ name: "doubles", version: "1.0.0", main: "index.js" }),
    "node_modules/doubles/index.js": `exports.double = value => value * 2;\n`,
    // A comment counts as source, and costs next to nothing to compile.
    "much.ts": `/*${Buffer.alloc(33 << 20, "much source\n").toString()}*/\nexport const much = 1;\n`,
    "lib.ts": `import { double } from "doubles";\nimport "./much";\nexport class Counter {\n  count = 0;\n  add(value: number): number {\n    return (this.count += double(value));\n  }\n}\n`,
    ...Object.fromEntries(
      names.map((name, index) => [
        `${name}.test.ts`,
        `import { test, expect } from "bun:test";
import { Counter } from "./lib";
test("${name}", () => {
  const counter = new Counter();
  counter.add(${index});
  expect(counter.add(1)).toBe(${index * 2 + 2});
  const shared = globalThis as { trail?: string[] };
  console.log("${name} comes after", (shared.trail ??= []).join(" "));
  shared.trail.push("${name}");
});
`,
      ]),
    ),
  });
  async function report(...flags: string[]) {
    // The word changes nothing: with it a compiled run says how it is built.
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
    if (flags.includes("--aot")) {
      if (flags.includes("--parallel=2")) expectLayers(stderr);
      else expect(stderr).toMatch(/^AOT test run \| one program/m);
    }
    const results = [...stderr.matchAll(/^\((pass|fail|skip)\) (\S+)/gm)].map(match => `${match[1]} ${match[2]}`);
    return {
      // What a worker prints comes out on stderr.
      seen: (stdout + stderr).split("\n").filter(line => line.includes(" comes after")),
      results: results.sort(),
      ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0],
      exitCode,
    };
  }
  const plain = await report();
  expect(plain).toEqual({
    seen: names.map((name, index) => `${name} comes after ${names.slice(0, index).join(" ")}`),
    results: names.map(name => `pass ${name}`),
    ran: "Ran 17 tests across 17 files",
    exitCode: 0,
  });
  expect(await report("--aot")).toEqual(plain);
  const isolated = await report("--isolate");
  expect(isolated.seen).toEqual(names.map(name => `${name} comes after `));
  expect(await report("--aot", "--isolate")).toEqual(isolated);
  // Workers take the files in no promised order.
  const inWorkers = await report("--aot", "--parallel=2");
  expect({ ...inWorkers, seen: inWorkers.seen.sort() }).toEqual(isolated);
  const plainInWorkers = await report("--parallel=2");
  expect({ ...plainInWorkers, seen: plainInWorkers.seen.sort() }).toEqual(isolated);
});
