// `const m = new Module(path); m._compile(text, path)`, as require-from-string and the hooks of pirates do it. The text gets a require of its own, and nobody has read what it names.
// The build took the call for one that evaluates text and no more, as eval does, so a test run as one program held none of the library for it:
// "Cannot load 'node:zlib': it isn't in this executable. Import it by name".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

const testFile = (way: string, says: string) => `
      import { test } from "bun:test";
      import Module from "node:module";
      const TEXT = ${JSON.stringify(text)};
      test("t", () => {
        const path = import.meta.dir + "/virtual.cjs";
        console.error("${says}", (() => { ${way} })());
      });`;

// The ways are the test files of one project, each in a realm of its own.
async function linesOf(flags: string[]) {
  const testFiles = Object.values(ways).map((way, index) => [`${index}.test.mjs`, testFile(way, `OUT${index}`)]);
  using dir = tempDir("aot-module-compile", {
    "other.cjs": `exports.b = "other";\n`,
    ...Object.fromEntries(testFiles),
  });
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)), exitCode };
}

let runs: Promise<Awaited<ReturnType<typeof linesOf>>[]> | undefined;
test.concurrent.each(Object.keys(ways))("%s: as the run builds itself", async name => {
  const says = `OUT${Object.keys(ways).indexOf(name)} `;
  const [plain, compiled] = (await (runs ??= Promise.all([linesOf([]), linesOf(["--aot"])]))).map(
    ({ lines, exitCode }) => ({
      lines: lines
        .filter(line => line.startsWith(says) || line.startsWith("error"))
        .map(line => line.replace(says, "OUT ")),
      exitCode,
    }),
  );
  expect(plain).toEqual({
    lines: ["OUT zipped | 1 | { a: Map(1) { 1 => 2 } } | other | 0 | virtual.cjs,string,virtual.cjs,false"],
    exitCode: 0,
  });
  expect(compiled).toEqual(plain);
});
