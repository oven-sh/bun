// `const m = new Module(path); m._compile(text, path)`, as require-from-string and the hooks of pirates do it. The text gets a require of its own, and nobody has read what it names.
// The build took the call for one that evaluates text and no more, as eval does, so a test run as one program held none of the library for it:
// "Cannot load 'node:zlib': it isn't in this executable. Import it by name".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

const text = `
  const ask = f => { try { return String(f()); } catch (error) { return error.constructor.name + ": " + error.message; } };
  module.exports = [
    ask(() => require("node:zlib").gunzipSync(require("node:zlib").gzipSync("zipped"))),
    ask(() => { const E = require("node:events"); const e = new E(); let n = 0; e.on("x", () => n++); e.emit("x"); return n; }),
    ask(() => require("node:util").inspect({ a: new Map([[1, 2]]) })),
    ask(() => require("./other.cjs").b),
    ask(() => process.stdout.listenerCount("drain")),
    ask(() => [__filename.split("/").pop(), typeof __dirname, module.id.split("/").pop(), require.main === module]),
  ].join(" | ");
`;
const ways = {
  "a module object that the test makes": `
    const m = new Module(path); m.filename = path; m.paths = Module._nodeModulePaths(import.meta.dir);
    m._compile(TEXT, path); return m.exports;`,
  "with the method taken off the prototype": `
    const m = new Module(path); m.filename = path; m.paths = Module._nodeModulePaths(import.meta.dir);
    Module.prototype._compile.call(m, TEXT, path); return m.exports;`,
  "by a helper": `
    const requireFromString = (code, filename) => { const m = new Module(filename, null); m.filename = filename; m.paths = Module._nodeModulePaths(import.meta.dir); m._compile(code, filename); return m.exports; };
    return requireFromString(TEXT, path);`,
};

const testFile = (way: string, says = "OUT") => `
      import { test } from "bun:test";
      import Module from "node:module";
      const TEXT = ${JSON.stringify(text)};
      test("t", () => {
        const path = import.meta.dir + "/virtual.cjs";
        console.error("${says}", (() => { ${way} })());
      });`;

const linesOf = (way: string, flags: string[], words?: string) =>
  linesOfAll({ "a.test.mjs": testFile(way) }, flags, words);

async function linesOfAll(testFiles: Record<string, string>, flags: string[], words?: string) {
  using dir = tempDir("aot-module-compile", { "other.cjs": `exports.b = "other";\n`, ...testFiles });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)), exitCode };
}

// Over layers each test file is a program of its own above what they share, so the ways share a run. AOT_WHOLE_GRIDS=1: a run to each.
let together: ReturnType<typeof linesOfAll> | undefined;
async function linesOverLayers(name: string) {
  const all = Object.entries(ways).map(([, way], index) => [`${index}.test.mjs`, testFile(way, `OUT${index}`)]);
  const { lines, exitCode } = await (together ??= linesOfAll(
    Object.fromEntries(all),
    ["--aot"],
    "TestRunLayers:2,TestRunPartFiles:1",
  ));
  const says = `OUT${Object.keys(ways).indexOf(name)} `;
  const mine = lines.filter(line => line.startsWith(says) || line.startsWith("error"));
  return { lines: mine.map(line => line.replace(says, "OUT ")), exitCode };
}

const plainRuns = new Map<string, ReturnType<typeof linesOf>>();
const plainOf = (name: string, way: (typeof ways)[keyof typeof ways]) =>
  plainRuns.getOrInsertComputed(name, () => linesOf(way, []));

test.concurrent.each(Object.entries(ways))("%s: plain Bun", async (name, way) => {
  const plain = await plainOf(name, way);
  expect(plain).toEqual({
    lines: ["OUT zipped | 1 | { a: Map(1) { 1 => 2 } } | other | 0 | virtual.cjs,string,virtual.cjs,false"],
    exitCode: 0,
  });
});

test.concurrent.each(
  Object.entries(ways).flatMap(([name, way]) =>
    (
      [
        ["as the run builds itself", undefined],
        ["two layers", "TestRunLayers:2"],
      ] as const
    ).map(([form, words]) => [name, form, way, words] as const),
  ),
)("%s: %s", async (name, _, way, words) => {
  const compiled = words && !runsWholeGrids ? linesOverLayers(name) : linesOf(way, ["--aot"], words);
  expect(await compiled).toEqual(await plainOf(name, way));
});
