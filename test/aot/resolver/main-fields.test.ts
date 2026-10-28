import { isWindows, type DirectoryTree } from "harness";
import { describe } from "../supported";
import { packageFiles, testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

type Answer = string | null;
type MainFieldsFixture = [name: string, manifest: object | null, files: string[], onImport: Answer, onRequire?: Answer];

const fixtures: MainFieldsFixture[] = [
  // At run time "main" wins over "module" and "jsnext:main", for `import` too.
  ["module-and-main", { module: "./esm.js", main: "./cjs.js" }, ["esm.js", "cjs.js"], "cjs.js"],
  ["module-only", { module: "./esm.js" }, ["esm.js"], "esm.js"],
  // Without "main", an index file counts as "main". The extension order of "main" finds it, and has no ".mjs".
  ["module-and-index", { module: "./esm.js" }, ["esm.js", "index.js"], "index.js"],
  ["module-and-index-mjs", { module: "./esm.js" }, ["esm.js", "index.mjs"], "esm.js"],
  ["main-only", { main: "./cjs.js" }, ["cjs.js", "index.js"], "cjs.js"],
  ["jsnext-and-main", { "jsnext:main": "./next.js", main: "./cjs.js" }, ["next.js", "cjs.js"], "cjs.js"],
  ["jsnext-only", { "jsnext:main": "./next.js" }, ["next.js"], "next.js"],
  ["jsnext-and-index", { "jsnext:main": "./next.js" }, ["next.js", "index.js"], "index.js"],
  // A "main" that resolves to nothing still rules out the index file as "main".
  ["main-missing", { module: "./esm.js", main: "./missing.js" }, ["esm.js", "index.js"], "esm.js"],
  ["main-missing-index", { main: "./missing.js" }, ["index.js"], "index.js"],
  // Only a non-empty string is a main field.
  ["main-empty", { module: "./esm.js", main: "" }, ["esm.js", "index.js"], "index.js"],
  ["main-not-a-string", { main: 5, module: ["./esm.js"] }, ["esm.js", "index.js"], "index.js"],
  ["main-no-extension", { main: "./lib/entry" }, ["lib/entry.ts", "lib/entry.js", "lib/entry.json"], "lib/entry.js"],
  ["main-no-extension-mjs", { main: "./lib/entry" }, ["lib/entry.mjs"], null],
  [
    "module-no-extension",
    { module: "./lib/entry" },
    ["lib/entry.js", "lib/entry.mjs"],
    "lib/entry.mjs",
    "lib/entry.js",
  ],
  // lib/package.json names other.js and is not read.
  ["main-directory", { main: "./lib" }, ["lib/index.ts", "lib/index.js", "lib/other.js"], "lib/index.js"],
  // After a trailing "/" no extension is added.
  // TODO: on Windows `bun run` loses the "/" and takes lib.js.
  ...((isWindows
    ? []
    : [
        ["main-trailing-slash", { main: "./lib/" }, ["lib.js", "lib/index.js"], "lib/index.js"],
        ["module-trailing-slash", { module: "./lib/" }, ["lib.js", "lib/index.js"], "lib/index.js"],
      ]) as MainFieldsFixture[]),
  ["main-dot", { main: "." }, ["index.js"], "index.js"],
  ["main-js-is-ts", { main: "./dist/index.js" }, ["dist/index.ts"], "dist/index.ts"],
  ["no-fields", {}, ["index.js", "index.mjs"], "index.mjs", "index.js"],
  ["no-manifest", null, ["index.js"], "index.js"],
  ["browser-ignored", { browser: "./browser.js", main: "./cjs.js" }, ["browser.js", "cjs.js"], "cjs.js"],
  [
    "browser-map-ignored",
    { browser: { "./cjs.js": "./browser.js" }, main: "./cjs.js" },
    ["browser.js", "cjs.js"],
    "cjs.js",
  ],
];

function fixtureFiles([name, manifest, files]: MainFieldsFixture): DirectoryTree {
  if (manifest !== null) return packageFiles(name, manifest, files);
  return Object.fromEntries(files.map(file => [`node_modules/${name}/${file}`, ""]));
}

function fixturePin([name, , , onImport, onRequire = onImport]: MainFieldsFixture): Pin {
  const answerPath = (answer: Answer) => (answer === null ? null : `node_modules/${name}/${answer}`);
  return ["importer.js", name, answerPath(onImport), answerPath(onRequire)];
}

const cases: ResolutionCase[] = [
  {
    name: "main fields",
    files: Object.assign(
      {
        "node_modules/main-directory/lib/package.json": JSON.stringify({ main: "./other.js" }),
        "node_modules/module-and-main/nested/package.json": JSON.stringify({ main: "./inner.js" }),
        "node_modules/module-and-main/nested/inner.js": "",
        "local/package.json": JSON.stringify({ module: "./esm.js", main: "./cjs.js" }),
        "local/esm.js": "",
        "local/cjs.js": "",
      },
      ...fixtures.map(fixtureFiles),
    ),
    pins: [
      ...fixtures.map(fixturePin),
      ["importer.js", "./local", "local/cjs.js"],
      ["importer.js", "module-and-main/nested", "node_modules/module-and-main/nested/inner.js"],
      ["importer.js", "no-such-package", null],
    ],
  },
];

describe("code resolution", () => testResolution(cases));
