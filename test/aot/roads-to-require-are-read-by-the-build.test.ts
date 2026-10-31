import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A file that the build does not find behind a require() still loads in a test run: from its text, in the interpreter, with the right answer, so nobody notices.
// An executable tells: each road here leads to a file of its own, and the packages are moved away before the executable runs.
const commonJsRoads: Record<string, string> = {
  "require": `require("./LEAF")`,
  "module.require": `module.require("./LEAF")`,
  "an alias of module.require, called with .call": `(() => { const load = module.require; return load.call(module, "./LEAF"); })()`,
  // @testing-library/dom hides its loads from bundlers so.
  "module && module.require, called with .call": `(() => { const load = module && module.require; return load.call(module, "./LEAF"); })()`,
  "require.call": `require.call(null, "./LEAF")`,
  "require.apply": `require.apply(null, ["./LEAF"])`,
  "(0, require)": `(0, require)("./LEAF")`,
  "typeof require && require": `typeof require === "function" && require("./LEAF")`,
  "createRequire(__filename)": `require("node:module").createRequire(__filename)("./LEAF")`,
  "an alias of require": `(() => { const load = require; return load("./LEAF"); })()`,
  "a parameter": `(load => load("./LEAF"))(require)`,
  "a name in a variable": `(() => { const name = "./LEAF"; return require(name); })()`,
  "a name that is joined": `require("./" + "LEAF")`,
  "a template": `require(\`./\${"LEAF"}\`)`,
  "a list that is joined": `require([".", "LEAF"].join("/"))`,
  ".replace()": `require("./xxx".replace("xxx", "LEAF"))`,
  ".replaceAll()": `require("_/LEAF".replaceAll("_", "."))`,
  ".trim()": `require(" ./LEAF ".trim())`,
  ".concat()": `require(".".concat("/", "LEAF"))`,
  ".slice()": `require("x./LEAFx".slice(1, -1))`,
  ".substring()": `require("x./LEAF".substring(1))`,
  ".toLowerCase()": `require("./LEAF".toUpperCase().toLowerCase())`,
  "String()": `require(String("./LEAF"))`,
  "a choice": `require(process.argv.length > 99 ? "./never" : "./LEAF")`,
  "require.resolve first": `require(require.resolve("./LEAF"))`,
  "path.join(__dirname, ..)": `require(require("node:path").join(__dirname, "LEAF"))`,
  "__dirname + ..": `require(__dirname + "/LEAF")`,
};
const moduleRoads: Record<string, string> = {
  "const require = createRequire(import.meta.url)": `made("./LEAF.cjs")`,
  "createRequire(import.meta.url)(..)": `createRequire(import.meta.url)("./LEAF.cjs")`,
  "import.meta.require": `import.meta.require("./LEAF.cjs")`,
  "import(new URL(.., import.meta.url).href)": `(await import(new URL("./LEAF.cjs", import.meta.url).href)).default`,
  "import(import.meta.resolve(..))": `(await import(import.meta.resolve("./LEAF.cjs"))).default`,
  "import(import.meta.dir + ..)": `(await import(import.meta.dir + "/LEAF.cjs")).default`,
  // An ES module makes itself the two names that a CommonJS file has.
  "createRequire(__filename), a shim": `createRequire(__filename)("./LEAF.cjs")`,
  "createRequire(fileURLToPath(import.meta.url))": `createRequire(fileURLToPath(import.meta.url))("./LEAF.cjs")`,
  "createRequire(new URL(import.meta.url))": `createRequire(new URL(import.meta.url))("./LEAF.cjs")`,
  "join(__dirname, ..), a shim": `made(join(__dirname, "LEAF.cjs"))`,
  "path.resolve(__dirname, ..), a shim": `made(path.resolve(__dirname, "LEAF.cjs"))`,
  "__dirname + .., a shim": `made(__dirname + "/LEAF.cjs")`,
  "path.dirname(fileURLToPath(import.meta.url))": `made(join(path.dirname(fileURLToPath(import.meta.url)), "LEAF.cjs"))`,
  "import(join(__dirname, ..)), a shim": `(await import(join(__dirname, "LEAF.cjs"))).default`,
  "import(pathToFileURL(join(__dirname, ..)).href), a shim": `(await import(pathToFileURL(join(__dirname, "LEAF.cjs")).href)).default`,
};

const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{}`,
  "node_modules/roads/package.json": `{ "name": "roads", "main": "index.js" }`,
  "node_modules/roads/never.js": `module.exports = "never";\n`,
  "node_modules/roads-esm/package.json": `{ "name": "roads-esm", "type": "module", "main": "index.js" }`,
  "main.js": `import commonJs from "roads";
import modules from "roads-esm";
for (const roads of [commonJs, modules]) for (const name in roads) console.log("SEEN " + name + " | " + roads[name]);
`,
};
const leaf = (name: string) => `module.exports = "${name}";\n`;
files["node_modules/roads/index.js"] = Object.entries(commonJsRoads)
  .map(([road, code], index) => {
    files[`node_modules/roads/c${index}.js`] = leaf("c" + index);
    return `try { exports[${JSON.stringify(road)}] = ${code.replaceAll("LEAF", "c" + index)}; } catch (error) { exports[${JSON.stringify(road)}] = error.name; }\n`;
  })
  .join("");
files["node_modules/roads-esm/index.js"] =
  `import { createRequire } from "node:module";\nimport { fileURLToPath, pathToFileURL } from "node:url";\nimport path, { dirname, join } from "node:path";\n` +
  `const __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);\nconst made = createRequire(import.meta.url);\nconst roads = {};\n` +
  Object.entries(moduleRoads)
    .map(([road, code], index) => {
      files[`node_modules/roads-esm/m${index}.cjs`] = leaf("m" + index);
      return `try { roads[${JSON.stringify(road)}] = ${code.replaceAll("LEAF", "m" + index)}; } catch (error) { roads[${JSON.stringify(road)}] = error.name; }\n`;
    })
    .join("") +
  `export default roads;\n`;

test("the file behind each road is in the executable", async () => {
  using dir = tempDir("aot-roads-to-require", files);
  const seenBy = async (...command: string[]) => {
    const { stdout, stderr, exitCode } = await run(command, String(dir), bunEnv);
    return {
      seen: stdout.split("\n").filter(line => line.startsWith("SEEN ")),
      stderr: exitCode ? stderr : "",
      exitCode,
    };
  };
  const plain = await seenBy(bunExe(), "main.js");
  expect(plain.seen.length).toBe(Object.keys(commonJsRoads).length + Object.keys(moduleRoads).length);
  expect(plain.seen.filter(line => line.includes("Error") || line.includes("Message"))).toEqual([]);
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  expect(await seenBy(bunExe(), "build", "--compile", "--aot", "--outfile", executable, "main.js")).toEqual({
    seen: [],
    stderr: "",
    exitCode: 0,
  });
  renameSync(join(String(dir), "node_modules"), join(String(dir), "moved-away"));
  expect(await seenBy(executable)).toEqual(plain);
}, 120_000);
