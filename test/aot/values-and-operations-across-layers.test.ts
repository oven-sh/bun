import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The same values, operations, callbacks and functions that take callbacks stand in a package (the lowest layer of a test run), in a helper (the layer over it) and in
// each test file (a piece). Every value of one is put under every operation of another, and what comes of it is written down: 57,000 lines.
// A run in layers has to write what a run as one program writes. Plain Bun differs from both in the text of functions and of some errors, so it is not the judge here.
const part = (name: string) =>
  readFileSync(join(import.meta.dir, "values-and-operations-across-layers", name + ".txt"), "utf8");
const shared = part("ops") + part("values") + part("hof");
const exported = shared + "export { makers, ops, Animal, Cat, callbacks, higher, afterwards, Base };\n";
const testFile = (name: string) => `import { expect, test } from "bun:test"; import { writeFileSync } from "node:fs";
import * as ofPackage from "pkg"; import * as ofHelper from "./helpers/shared.js";
${shared}${part("show")}
test("every value under every operation", async () => {
  const lines = [];
  runMatrix("own value, own operation", makers, ops, lines);
  runMatrix("helper's value, own operation", ofHelper.makers, ops, lines);
  runMatrix("own value, helper's operation", makers, ofHelper.ops, lines);
  runMatrix("package's value, own operation", ofPackage.makers, ops, lines);
  runMatrix("own value, package's operation", makers, ofPackage.ops, lines);
  runMatrix("package's value, helper's operation", ofPackage.makers, ofHelper.ops, lines);
  runMatrix("helper's value, package's operation", ofHelper.makers, ofPackage.ops, lines);
  runMatrix("the namespaces", { ofHelper: () => ofHelper, ofPackage: () => ofPackage }, ops, lines);
  runMatrix("the namespaces, helper's operation", { ofHelper: () => ofHelper, ofPackage: () => ofPackage }, ofHelper.ops, lines);
  const layers = { own: { callbacks, higher, afterwards, makers }, helper: ofHelper, package: ofPackage };
  for (const from of Object.keys(layers)) for (const to of Object.keys(layers)) {
    await runHigher(from + "'s callback, " + to + "'s function", layers[from].callbacks, layers[to].higher, layers[to].afterwards, lines);
    runPairs(from + "'s value against " + to + "'s", layers[from].makers, layers[to].makers, expect, lines);
  }
  writeFileSync(process.env.SEEN_IN + "/${name}.txt", lines.join("\\n") + "\\n");
  expect(lines.length).toBeGreaterThan(50000);
}, 240000);
`;
const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }`,
  "node_modules/pkg/index.js": exported,
  "helpers/shared.js": exported,
  "one.test.js": testFile("one"),
  "two.test.js": testFile("two"),
};

async function linesOf(directory: string, way: string, words: string) {
  const seenIn = join(directory, "seen-" + way);
  mkdirSync(seenIn);
  const env = { ...bunEnv, SEEN_IN: seenIn, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stderr, exitCode } = await run([bunExe(), "test", "--aot", "--isolate"], directory, env);
  expect({ way, exitCode, stderr: exitCode ? stderr.slice(-2000) : "" }).toEqual({ way, exitCode: 0, stderr: "" });
  return ["one", "two"].map(name => readFileSync(join(seenIn, name + ".txt"), "utf8").split("\n"));
}

test("a run in layers writes what a run as one program writes", async () => {
  using dir = tempDir("aot-values-and-operations-across-layers", files);
  const asOneProgram = await linesOf(String(dir), "one-program", "TestRunLayers:0");
  for (const layers of [2, 3]) {
    const inLayers = await linesOf(String(dir), `layers-${layers}`, `TestRunLayers:${layers},TestRunPartFiles:1`);
    for (const file of [0, 1]) {
      expect(asOneProgram[file].length).toBeGreaterThan(50000);
      const unlike = asOneProgram[file].flatMap((line, index) =>
        line === inLayers[file][index] ? [] : [`${line}\n  in ${layers} layers: ${inLayers[file][index]}`],
      );
      expect(unlike.slice(0, 20)).toEqual([]);
      expect(inLayers[file].length).toBe(asOneProgram[file].length);
    }
  }
}, 600000);
