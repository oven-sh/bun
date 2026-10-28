import { describe } from "../supported";
import { packageFiles, testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

type Answer = string | null | [onImport: string | null, onRequire: string | null];
type PatternsFixture = [name: string, exportsMap: object, files: string[], answers: Record<string, Answer>];

const fixtures: PatternsFixture[] = [
  [
    "star",
    { "./features/*": "./src/features/*.js" },
    [
      "src/features/a.js",
      "src/features/deep/b.js",
      "src/features/a b.js",
      "src/features/a/b.js",
      "src/features/node_modules/x.js",
      "src/secret.js",
    ],
    {
      "/features/a": "src/features/a.js",
      "/features/deep/b": "src/features/deep/b.js",
      "/features/a%20b": "src/features/a b.js",
      "/features/missing": null,
      "/other": null,
      "": null,
      "/features/../secret": null,
      "/features/%2e%2e/secret": null,
      "/features/node_modules/x": null,
      "/features/a%2fb": null,
    },
  ],
  ["trailer", { "./features/*.js": "./src/*.js" }, ["src/a.js"], { "/features/a.js": "src/a.js", "/features/a": null }],
  [
    "longest-base",
    { "./*": "./lib/*.js", "./features/*": "./src/*.js" },
    ["lib/a.js", "lib/features/a.js", "src/a.js"],
    { "/a": "lib/a.js", "/features/a": "src/a.js" },
  ],
  [
    "longer-key",
    { "./a/*": "./one/*.js", "./a/*.js": "./two/*.js" },
    ["one/x.js", "one/x.js.js", "two/x.js"],
    { "/a/x.js": "two/x.js", "/a/x": "one/x.js" },
  ],
  [
    "excluded",
    { "./features/*": "./src/*.js", "./features/private/*": null },
    ["src/a.js", "src/private/key.js"],
    { "/features/a": "src/a.js", "/features/private/key": null },
  ],
  [
    "exact-first",
    { "./features/*": "./src/*.js", "./features/special": "./special.js" },
    ["src/special.js", "special.js"],
    { "/features/special": "special.js" },
  ],
  [
    "slash",
    { "./lib/": "./src/" },
    ["src/a.js", "src/dir/index.js"],
    { "/lib/a": "src/a.js", "/lib/a.js": "src/a.js", "/lib/dir": "src/dir/index.js" },
  ],
  // An extension is tried only for a target with a "*". A directory never resolves to its index file.
  [
    "no-extension",
    { "./*": "./dist/*", "./exact": "./dist/exact" },
    ["dist/a.mjs", "dist/a.cjs", "dist/b.js", "dist/dir/index.js", "dist/exact.js"],
    { "/a": ["dist/a.mjs", "dist/a.cjs"], "/b": "dist/b.js", "/b.js": "dist/b.js", "/dir": null, "/exact": null },
  ],
  ["js-retry", { "./sub": "./sub.js" }, ["sub.js"], { "/sub": "sub.js", "/sub.js": "sub.js", "/sub.mjs": null }],
  [
    "invalid-targets",
    { "./up": "../outside.js", "./nm": "./node_modules/x.js", "./bare": "lib/x.js", "./dots": "./a/../b.js" },
    ["b.js", "lib/x.js", "node_modules/x.js"],
    { "/up": null, "/nm": null, "/bare": null, "/dots": null },
  ],
  ["hidden-manifest", { ".": "./index.js" }, ["index.js"], { "/package.json": "package.json" }],
  ["two-stars", { "./*": "./dist/*/*.js" }, ["dist/a/a.js"], { "/a": "dist/a/a.js" }],
  ["@scope/scoped", { "./features/*": "./src/*.js" }, ["src/a.js"], { "/features/a": "src/a.js" }],
  ["at-in-subpath", { "./*": "./lib/*.js" }, ["lib/@scope/x.js"], { "/@scope/x": "lib/@scope/x.js" }],
];

function fixturePins([name, , , answers]: PatternsFixture): Pin[] {
  const answerPath = (answer: string | null) => (answer === null ? null : `node_modules/${name}/${answer}`);
  return Object.entries(answers).map(([subpath, answer]): Pin => {
    const [onImport, onRequire] = Array.isArray(answer) ? answer : [answer, answer];
    return ["importer.js", name + subpath, answerPath(onImport), answerPath(onRequire)];
  });
}

const cases: ResolutionCase[] = [
  {
    name: "patterns",
    files: Object.assign(
      { "node_modules/outside.js": "" },
      ...fixtures.map(([name, exportsMap, files]) => packageFiles(name, { exports: exportsMap }, files)),
    ),
    pins: fixtures.flatMap(fixturePins),
  },
];

describe("code resolution", () => testResolution(cases));
