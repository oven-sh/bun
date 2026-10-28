import type { DirectoryTree } from "harness";
import { describe } from "../supported";
import { packageFiles, testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

type Answer = string | null;
type AnswersByKind = [onImport: string, onRequire: string];
type ConditionsFixture = [
  name: string,
  manifest: object | string,
  files: string[],
  onImport: Answer,
  onRequire?: Answer,
];

const inactiveConditions = [
  "browser",
  "module",
  "types",
  "deno",
  "worker",
  "development",
  "production",
  "react-server",
];

const fixtures: ConditionsFixture[] = [
  ["by-kind", { exports: { import: "./esm.mjs", require: "./cjs.cjs" } }, ["esm.mjs", "cjs.cjs"], "esm.mjs", "cjs.cjs"],
  [
    "bun-first",
    { exports: { bun: "./bun.js", node: "./node.js", default: "./default.js" } },
    ["bun.js", "node.js", "default.js"],
    "bun.js",
  ],
  ["key-order", { exports: { default: "./default.js", bun: "./bun.js" } }, ["default.js", "bun.js"], "default.js"],
  ["node", { exports: { node: "./node.js", default: "./default.js" } }, ["node.js", "default.js"], "node.js"],
  [
    "node-addons",
    { exports: { "node-addons": "./addons.js", default: "./default.js" } },
    ["addons.js", "default.js"],
    "addons.js",
  ],
  [
    "off",
    {
      exports: {
        ...Object.fromEntries(inactiveConditions.map(condition => [condition, "./never.js"])),
        default: "./default.js",
      },
    },
    ["never.js", "default.js"],
    "default.js",
  ],
  [
    "nested",
    { exports: { node: { import: "./node.mjs", require: "./node.cjs" }, default: "./default.js" } },
    ["node.mjs", "node.cjs", "default.js"],
    "node.mjs",
    "node.cjs",
  ],
  [
    "nested-no-match",
    { exports: { bun: { browser: "./never.js" }, default: "./default.js" } },
    ["never.js", "default.js"],
    "default.js",
  ],
  ["no-match", { exports: { browser: "./never.js" }, main: "./main.js" }, ["never.js", "main.js", "index.js"], null],
  ["import-only", { exports: { import: "./esm.mjs" } }, ["esm.mjs"], "esm.mjs", null],
  [
    "matched-missing",
    { exports: { import: "./missing.mjs", default: "./default.js" } },
    ["default.js"],
    null,
    "default.js",
  ],
  ["null-target", { exports: { bun: null, default: "./default.js" } }, ["default.js"], null],
  [
    "array-fallback",
    { exports: [{ browser: "./never.js" }, "./fallback.js"] },
    ["never.js", "fallback.js"],
    "fallback.js",
  ],
  // Node tries the next entry after an invalid or null one. Bun stops there.
  ["array-invalid-first", { exports: ["not-relative", "./fallback.js"] }, ["fallback.js"], null],
  ["array-null-first", { exports: [null, "./fallback.js"] }, ["fallback.js"], null],
  ["array-empty", { exports: [], main: "./main.js" }, ["main.js"], null],
  ["mixed-keys", { exports: { ".": "./a.js", import: "./b.js" } }, ["a.js", "b.js"], null],
  ["string", { exports: "./main.js", main: "./other.js" }, ["main.js", "other.js"], "main.js"],
  ["null-exports", { exports: null, main: "./other.js" }, ["other.js"], "other.js"],
  ["false-exports", { exports: false, main: "./main.js" }, ["main.js"], null],
  ["number-exports", { exports: 1, main: "./main.js" }, ["main.js"], null],
  [
    "dot-conditions",
    { exports: { ".": { require: "./cjs.cjs", default: "./esm.mjs" } } },
    ["cjs.cjs", "esm.mjs"],
    "esm.mjs",
    "cjs.cjs",
  ],
  ["subpath", { exports: { "./sub": { require: "./sub.cjs", default: "./sub.mjs" } } }, ["sub.cjs", "sub.mjs"], null],
  // Every entry of a repeated key is visited, in order.
  [
    "repeated-key",
    '{"name":"repeated-key","exports":{"bun":{"browser":"./never.js"},"bun":"./second.js","default":"./default.js"}}',
    ["never.js", "second.js", "default.js"],
    "second.js",
  ],
];

function answerPath(name: string, answer: Answer): Answer {
  return answer === null ? null : `node_modules/${name}/${answer}`;
}

function customConditionFiles(): DirectoryTree {
  return {
    ...packageFiles("custom", { exports: { custom: "./custom.js", default: "./default.js" } }, [
      "custom.js",
      "default.js",
    ]),
    ...packageFiles("two", { exports: { second: "./second.js", custom: "./custom.js", default: "./default.js" } }, [
      "second.js",
      "custom.js",
      "default.js",
    ]),
  };
}

function customConditionCase(name: string, conditions: string[], custom: string, two: string): ResolutionCase {
  return {
    name,
    files: customConditionFiles(),
    pins: [
      ["importer.js", "custom", answerPath("custom", custom)],
      ["importer.js", "two", answerPath("two", two)],
    ],
    options: { conditions },
  };
}

const matchedByKind: AnswersByKind = ["import.js", "require.js"];

function kindConditionPin(name: string, [onImport, onRequire]: AnswersByKind): Pin {
  return ["importer.js", name, answerPath(name, onImport), answerPath(name, onRequire)];
}

function kindConditionCase(
  name: string,
  conditions: string[],
  importFirst: AnswersByKind,
  requireFirst: AnswersByKind,
): ResolutionCase {
  const files = ["import.js", "require.js"];
  return {
    name,
    files: {
      ...packageFiles("import-first", { exports: { import: "./import.js", require: "./require.js" } }, files),
      ...packageFiles("require-first", { exports: { require: "./require.js", import: "./import.js" } }, files),
    },
    pins: [kindConditionPin("import-first", importFirst), kindConditionPin("require-first", requireFirst)],
    options: { conditions },
  };
}

const cases: ResolutionCase[] = [
  {
    name: "conditions",
    files: Object.assign({}, ...fixtures.map(([name, manifest, files]) => packageFiles(name, manifest, files))),
    pins: [
      ...fixtures.map(([name, , , onImport, onRequire = onImport]): Pin => [
        "importer.js",
        name,
        answerPath(name, onImport),
        answerPath(name, onRequire),
      ]),
      ["importer.js", "subpath/sub", "node_modules/subpath/sub.mjs", "node_modules/subpath/sub.cjs"],
    ],
  },
  customConditionCase("without --conditions", [], "default.js", "default.js"),
  customConditionCase("one condition", ["custom"], "custom.js", "custom.js"),
  customConditionCase("two conditions", ["custom", "second"], "custom.js", "second.js"),
  customConditionCase("conditions are taken back", [], "default.js", "default.js"),
  // The condition of one import kind, given by name, matches for the other kind too.
  kindConditionCase("require as a condition", ["require"], matchedByKind, ["require.js", "require.js"]),
  kindConditionCase("require is taken back from import only", [], matchedByKind, matchedByKind),
  kindConditionCase("import as a condition", ["import"], ["import.js", "import.js"], matchedByKind),
  kindConditionCase("import is taken back from require only", [], matchedByKind, matchedByKind),
];

describe("code resolution", () => testResolution(cases));
