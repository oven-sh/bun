import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Vitest leaves a package to Node, outside the modules that it resets. It loads an ES module that Node would read as CommonJS itself, like a file of the project.
const files = {
  "package.json": `{ "name": "project" }`,
  "node_modules/untyped/package.json": `{ "name": "untyped", "main": "index.js" }`,
  "node_modules/untyped/index.js": `console.log("SAID untyped runs"); export default {};`,
  "node_modules/untyped/inner.mjs": `console.log("SAID untyped/inner.mjs runs"); export default {};`,
  "node_modules/typed/package.json": `{ "name": "typed", "type": "module", "main": "index.js" }`,
  "node_modules/typed/index.js": `console.log("SAID typed runs"); export default {};`,
  "node_modules/common/package.json": `{ "name": "common", "main": "index.js" }`,
  "node_modules/common/index.js": `console.log("SAID common runs"); module.exports = {};`,
  "own.js": `console.log("SAID own runs"); export default {};`,
  "reset.test.js": `
    import { jest, test, vi } from "bun:test";
    const load = async () =>
      [await import("untyped"), await import("untyped/inner.mjs"), await import("typed"), await import("common"), await import("./own.js")].map(it => it.default);
    const first = await load();
    for (const [name, reset] of [["vi", vi.resetModules], ["jest", jest.resetModules]])
      test(name, async () => {
        reset();
        console.log("SAID", name, (await load()).map((loaded, at) => loaded === first[at]).join());
      });`,
};
const ran = (...names: string[]) => names.map(name => `SAID ${name} runs`);
const all = ["untyped", "untyped/inner.mjs", "typed", "common", "own"];

test.concurrent.each([
  ["plain", [], ""],
  ["as one program", ["--aot"], "TestRunLayers:0"],
  ["over two layers", ["--aot"], "TestRunLayers:2,TestRunPartFiles:1"],
])(
  "vi.resetModules() keeps what Vitest leaves to Node, jest.resetModules() keeps nothing: %s",
  async (_, flags, words) => {
    using directory = tempDir("aot-reset-packages", files);
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(directory), env);
    const said = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SAID "));
    const at = (line: string) => said.indexOf(line);
    expect(said.slice(0, at("SAID vi false,true,true,true,false")).sort()).toEqual(
      [...ran(...all), ...ran("untyped", "own")].sort(),
    );
    expect(said.slice(at("SAID vi false,true,true,true,false") + 1).sort()).toEqual(
      [...ran(...all), "SAID jest false,false,false,false,false"].sort(),
    );
  },
);
