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
  // Packages that know webpack hide their loads from it so.
  "__non_webpack_require__ or require": `(typeof __non_webpack_require__ === "function" ? __non_webpack_require__ : require)("./LEAF")`,
  "globalThis.require ?? require": `(globalThis.require ?? require)("./LEAF")`,
  "globalThis.require || require": `(globalThis.require || require)("./LEAF")`,
  "an alias of such a choice": `(() => { const load = typeof __non_webpack_require__ === "function" ? __non_webpack_require__ : require; return load("./LEAF"); })()`,
  "a choice that names itself": `(() => { var load = load || require; return load("./LEAF"); })()`,
  "createRequire(__filename)": `require("node:module").createRequire(__filename)("./LEAF")`,
  // What createRequire() makes looks for names from the folder of the path that it was given.
  "createRequire(__dirname + '/')": `require("node:module").createRequire(__dirname + "/")("./LEAF")`,
  "createRequire() of a file beside": `require("node:module").createRequire(__dirname + "/beside.js")("./LEAF")`,
  "createRequire() of a file in another folder": `require("node:module").createRequire(__dirname + "/../roads-esm/index.js")("../roads/LEAF")`,
  "createRequire() of another folder": `require("node:module").createRequire(__dirname + "/../roads-esm/")("../roads/LEAF")`,
  "createRequire(__dirname), which is a file to it": `require("node:module").createRequire(__dirname)("./roads/LEAF")`,
  "createRequire(path.join(__dirname, ..))": `require("node:module").createRequire(require("node:path").join(__dirname, "..", "roads-esm", "index.js"))("../roads/LEAF")`,
  "createRequire() of another folder, in a variable": `(() => { const load = require("node:module").createRequire(__dirname + "/../roads-esm/"); return load("../roads/LEAF"); })()`,
  "createRequire() of another folder, a package": `require("node:module").createRequire(__dirname + "/../roads-esm/")("roads/LEAF")`,
  "an alias of require": `(() => { const load = require; return load("./LEAF"); })()`,
  "a parameter": `(load => load("./LEAF"))(require)`,
  "a name in a variable": `(() => { const name = "./LEAF"; return require(name); })()`,
  "a name handed to a function that is called where it is written": `(name => require(name))("./LEAF")`,
  "a default of such a function": `((name = "./LEAF") => require(name))()`,
  "a table handed to such a function": `(table => Object.keys(table).map(key => require(table[key])))({ a: "./LEAF" })[0]`,
  "a function handed to such a function": `(make => require(make("LEAF")))(name => "./" + name)`,
  "such a function in a field": `new (class { field = (name => require(name))("./LEAF"); })().field`,
  "such a function in a method": `new (class { method() { return (name => require(name))("./LEAF"); } })().method()`,
  "such a function, written with function": `(function (name) { return require(name); })("./LEAF")`,
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
  "'file://' + __dirname + ..": `require("file://" + __dirname + "/LEAF.js")`,
  "'file://' + path.join(__dirname, ..)": `require("file://" + require("node:path").join(__dirname, "LEAF.js"))`,
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
  "createRequire(import.meta.dir + '/')": `createRequire(import.meta.dir + "/")("./LEAF.cjs")`,
  "createRequire(join(__dirname, ..)), a shim": `createRequire(join(__dirname, "beside.js"))("./LEAF.cjs")`,
  "createRequire() of another folder, a shim": `createRequire(\`\${__dirname}/../roads/\`)("../roads-esm/LEAF.cjs")`,
  "join(__dirname, ..), a shim": `made(join(__dirname, "LEAF.cjs"))`,
  "path.resolve(__dirname, ..), a shim": `made(path.resolve(__dirname, "LEAF.cjs"))`,
  "__dirname + .., a shim": `made(__dirname + "/LEAF.cjs")`,
  "import('file://' + __dirname + ..), a shim": `(await import(\`file://\${__dirname}/LEAF.cjs\`)).default`,
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
