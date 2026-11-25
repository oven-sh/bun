// `bun build --compile --aot --external left-out`: the code of the package is not compiled. The executable refuses it every file of the program
// but the entry points and the files of data. What it may load is whole: each case prints what `bun <the main file>` prints in the same folder.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const cases: Record<string, { files: Record<string, string>; prints: string }> = {
  "the main file while it still runs: its first object": {
    files: {
      "main.cjs": `const asker = require("./asker.cjs");
module.exports = function serve() {};
console.log(asker.seen, typeof module.exports);
`,
      "asker.cjs": `exports.seen = require("left-out").seen;
`,
      "node_modules/left-out/index.js": `exports.seen = typeof require(Bun.main);
`,
    },
    prints: "object function\n",
  },
  "a JSON file: every name, not only those that the program reads": {
    files: {
      "main.mjs": `import { read } from "left-out";
import cfg from "./cfg.json";
console.log(Object.keys(cfg).length);
console.log(await read(import.meta.dir + "/" + JSON.parse('"cfg"') + ".json"));
`,
      "cfg.json": `{ "name": "made-up", "size": 3, "spare": "unread" }
`,
      "node_modules/left-out/index.js": `exports.read = async path => {
  const got = await import(path);
  return Object.keys(got).sort().join(" ") + ", " + typeof got.default + ", " + got.spare;
};
`,
    },
    prints: "3\ndefault name size spare, object, unread\n",
  },
  "a JSON file: the program reads what is stored into its object": {
    files: {
      "main.mjs": `import { store } from "left-out";
import cfg from "./cfg.json";
await store(import.meta.dir + "/" + JSON.parse('"cfg"') + ".json");
console.log(cfg.size);
`,
      "cfg.json": `{ "name": "made-up", "size": 3, "spare": "unread" }
`,
      "node_modules/left-out/index.js": `exports.store = async path => {
  (await import(path)).default.size = 9;
};
`,
    },
    prints: "9\n",
  },
};

test.each(Object.keys(cases))("%s", async name => {
  const { files, prints } = cases[name];
  using dir = tempDir("aot-what-the-code-of-a-package-left-out-may-load-is-whole", files);
  const directory = String(dir);
  const main = Object.keys(files)[0];
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), main], directory, bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--external", "left-out", main, "--outfile", executable],
    directory,
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], directory, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
});
