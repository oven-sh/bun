import { describe } from "../supported";
import { packageFiles, testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

type Answer = string | null | [onImport: string | null, onRequire: string | null];
type ImportsFixture = [name: string, importsMap: object | string, files: string[], answers: Record<string, Answer>];

const fixtures: ImportsFixture[] = [
  ["exact", { "#a": "./lib/a.js" }, ["lib/a.js"], { "#a": "lib/a.js", "#b": null, "#a/x": null }],
  [
    "by-kind",
    { "#k": { import: "./k.mjs", require: "./k.cjs" }, "#c": { bun: "./bun.js", default: "./default.js" } },
    ["k.mjs", "k.cjs", "bun.js", "default.js"],
    { "#k": ["k.mjs", "k.cjs"], "#c": "bun.js" },
  ],
  [
    "patterns",
    { "#lib/*": "./src/lib/*.js", "#lib/special/*": "./special/*.js", "#t/*.js": "./t/*.js" },
    ["src/lib/a.js", "src/lib/special/b.js", "special/b.js", "t/a.js"],
    { "#lib/a": "src/lib/a.js", "#lib/special/b": "special/b.js", "#t/a.js": "t/a.js", "#t/a": null },
  ],
  [
    "package-target",
    { "#dep": "dep", "#dep/*": "dep/*", "#sealed/*": "sealed/*" },
    [],
    {
      "#dep": "node_modules/dep/index.js",
      "#dep/sub.js": "node_modules/dep/sub.js",
      "#dep/sub": "node_modules/dep/sub.js",
      "#sealed/x": "node_modules/sealed/lib/x.js",
      "#sealed/y.js": null,
    },
  ],
  ["chained", { "#one": "#two", "#two": "./two.js" }, ["two.js"], { "#two": "two.js", "#one": null }],
  [
    "invalid-targets",
    { "#up": "../outside.js", "#abs": "/outside.js", "#nm": "./node_modules/x.js", "#dots": "./a/../b.js" },
    ["b.js", "node_modules/x.js"],
    { "#up": null, "#abs": null, "#nm": null, "#dots": null },
  ],
  ["null-target", { "#n": null, "#m": { bun: null, default: "./d.js" } }, ["d.js"], { "#n": null, "#m": null }],
  ["hash", { "#": "./hash.js", "#/x": "./x.js" }, ["hash.js", "x.js"], { "#": null, "#/x": null }],
  ["not-a-map", "./x.js", ["x.js"], { "#a": null }],
  [
    "extensions",
    { "#ts": "./ts.js", "#mts": "./m.mjs", "#s/*": "./s/*" },
    ["ts.ts", "m.mts", "s/a.mjs", "s/a.cjs"],
    { "#ts": "ts.ts", "#mts": "m.mts", "#s/a": ["s/a.mjs", "s/a.cjs"] },
  ],
  ["nearest", { "#a": "./a.js" }, ["a.js"], { "#a": "a.js" }],
];

function fixturePins([name, , , answers]: ImportsFixture): Pin[] {
  const answerPath = (answer: string | null) => (answer === null ? null : `apps/${name}/${answer}`);
  return Object.entries(answers).map(([specifier, answer]): Pin => {
    const [onImport, onRequire] = Array.isArray(answer) ? answer : [answer, answer];
    return [`apps/${name}/src/importer.js`, specifier, answerPath(onImport), answerPath(onRequire)];
  });
}

const cases: ResolutionCase[] = [
  {
    name: "imports",
    files: Object.assign(
      { "apps/outside.js": "" },
      ...fixtures.map(([name, importsMap, files]) =>
        packageFiles(name, { imports: importsMap }, files, `apps/${name}`),
      ),
      packageFiles("dep", { main: "./index.js" }, ["index.js", "sub.js"], "apps/package-target/node_modules/dep"),
      packageFiles(
        "sealed",
        { exports: { "./x": "./lib/x.js" } },
        ["lib/x.js", "y.js"],
        "apps/package-target/node_modules/sealed",
      ),
      packageFiles("builtin-target", { imports: { "#fs": "node:fs", "#path": "path" } }, [], "apps/builtin-target"),
      packageFiles("inner", "{}", [], "apps/nearest/inner"),
      packageFiles("hash-package", {}, ["node_modules/#pkg/index.js"], "apps/hash-package"),
      packageFiles("dependency", { imports: { "#internal": "./internal.js" } }, ["internal.js"]),
    ),
    pins: [
      ...fixtures.flatMap(fixturePins),
      ["apps/builtin-target/src/importer.js", "#fs", "builtin:node:fs"],
      ["apps/builtin-target/src/importer.js", "#path", "builtin:node:path"],
      ["apps/nearest/inner/importer.js", "#a", null],
      ["apps/hash-package/src/importer.js", "#pkg"],
      ["node_modules/dependency/importer.js", "#internal", "node_modules/dependency/internal.js"],
      ["importer.js", "#internal", null],
    ],
  },
];

describe("code resolution", () => testResolution(cases));
