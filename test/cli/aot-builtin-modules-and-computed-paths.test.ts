import { expect } from "bun:test";
import { tempDir } from "harness";
import { test } from "../aot/supported";
import { compileEachAlone, importingByName, oneAfterTheOther, startsAtAnyEntryPoint } from "./aot-builtin-modules";

const plain = "plain.cjs";
const never = (how: string) =>
  `const load = name => ${how};\nconsole.log(process.argv.length > 100 ? load("lib") : "run");`;

const withoutADoor: Record<string, string> = {
  "a-sum-that-starts-with-a-dot.cjs": never('require("./" + name + ".cjs")'),
  "a-template-that-starts-with-a-dot.cjs": never("require(`./${name}.cjs`)"),
  "a-template-that-starts-with-a-scope.cjs": never("require(`@scope/package-${name}/addon.node`)"),
  "a-sum-that-starts-with-the-own-folder.cjs": never('require(__dirname + "/" + name + ".cjs")'),
  "a-template-that-starts-with-the-own-folder.cjs": never("require(`${__dirname}/${name}.cjs`)"),
  "joined-to-the-own-folder.cjs": `const path = require("node:path");\n${never('require(path.join(__dirname, name + ".cjs"))')}`,
  "resolved.cjs": `const path = require("path");\n${never('require(path.resolve(name + ".cjs"))')}`,
  "an-import-that-starts-with-a-dot.mjs": never('import("./" + name + ".cjs")'),
  "an-import-joined-to-the-own-folder.mjs": `import { join } from "node:path";\n${never('import(join(import.meta.dirname, name + ".cjs"))')}`,
};

const querystring = `const name = process.argv[5] ?? "querystring";\n`;
const loaded = (how: string) => `console.log(typeof ${how}.escape === "function" ? "run" : "");`;
const withADoor = importingByName("node:querystring", {
  "a-sum-that-starts-with-a-scheme.cjs": `${querystring}${loaded('require("node:" + name)')}`,
  "a-sum-that-starts-with-nothing.cjs": `${querystring}${loaded('require("" + name)')}`,
  "a-template-that-starts-with-the-name.cjs": `${querystring}${loaded("require(`${name}`)")}`,
  "joined-to-a-dot.cjs": `const path = require("node:path");\n${querystring}${loaded('require(path.join("./", name))')}`,
  "joined-by-a-function-of-the-program.cjs":
    `const path = { join: (...parts) => parts[parts.length - 1], resolve: part => part };\n${querystring}${loaded("require(path.join(__dirname, name))")}\n${loaded("require(path.resolve(name))")}`.replace(
      `"run" : "");\n`,
      `"" : "");\n`,
    ),
  "a-folder-of-the-program.cjs": `${querystring}{\n  const __dirname = "";\n  ${loaded("require(__dirname + name)")}\n}`,
});

const inFolder = (folder: string, programs: Record<string, string>) =>
  Object.fromEntries(Object.entries(programs).map(([entry, text]) => [`${folder}/${entry}`, text]));

test.skipIf(!startsAtAnyEntryPoint)(
  "a computed name that can only be a path brings no built-in module into the executable",
  async () => {
    // Each kind in a folder of its own: `require("./" + name + ".cjs")` may load every .cjs file beside it, and those with a door import node:querystring.
    using dir = tempDir("builtin-modules-and-computed-paths", {
      ...inFolder("paths", {
        [plain]: `console.log("run");`,
        ...withoutADoor,
        "all.mjs": oneAfterTheOther(withoutADoor),
      }),
      ...inFolder("names", withADoor),
    });
    const names = Object.keys(inFolder("names", withADoor));
    const ran = await compileEachAlone(String(dir), [`paths/${plain}`, "paths/all.mjs", ...names]);
    expect(
      Object.fromEntries(
        Object.entries(ran).map(([entry, { stdout, exitCode }]) => [entry, [stdout.trim(), exitCode]]),
      ),
    ).toEqual({
      [`paths/${plain}`]: ["run", 0],
      "paths/all.mjs": [Object.keys(withoutADoor).fill("run").join("\n"), 0],
      ...Object.fromEntries(names.map(entry => [entry, ["run", 0]])),
    });
    // The functions of the loader come with a computed path: about as much code again as a plain program. A built-in module such as node:zlib is four times that.
    expect(ran["paths/all.mjs"].bytes).toBeLessThan(3 * ran[`paths/${plain}`].bytes);
  },
  280_000,
);
