import { expect } from "bun:test";
import { tempDir } from "harness";
import { describe, test } from "../supported";
import { packageFiles, testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

type RewriteFixture = [directory: string, files: string[], answers: Record<string, string | null>];

const projectFixtures: RewriteFixture[] = [
  ["only-ts", ["a.ts"], { "a.js": "a.ts", "a.mjs": null, "a.cjs": null }],
  ["only-tsx", ["a.tsx"], { "a.js": "a.tsx", "a.jsx": "a.tsx" }],
  ["only-mts", ["a.mts"], { "a.js": "a.mts", "a.mjs": "a.mts", "a.cjs": null }],
  ["only-cts", ["a.cts"], { "a.cjs": "a.cts", "a.js": null, "a.mjs": null }],
  ["both", ["a.js", "a.ts"], { "a.js": "a.js" }],
  ["ts-and-tsx", ["a.ts", "a.tsx"], { "a.js": "a.ts", "a.jsx": "a.ts" }],
  // An appended extension is tried before a replaced one.
  ["appended", ["a.js.ts", "a.ts"], { "a.js": "a.js.ts" }],
  ["reverse", ["a.js"], { "a.ts": null }],
  ["declaration", ["a.d.ts"], { "a.js": null, "a": null }],
  ["directory", ["a.js/index.ts"], { "a.js": "a.js/index.ts" }],
  ["dotted", ["a.b.ts"], { "a.b.js": "a.b.ts", "a.b": "a.b.ts" }],
];

// Under the "aot" condition the extensions are rewritten inside node_modules as they are outside.
const nodeModulesFixtures: RewriteFixture[] = [
  ["only-ts", ["a.ts"], { "a.js": "a.ts", "a.mjs": null, "a.cjs": null }],
  ["only-mts", ["a.mts"], { "a.js": "a.mts", "a.mjs": "a.mts", "a.cjs": null }],
  ["only-cts", ["a.cts"], { "a.cjs": "a.cts", "a.js": null, "a.mjs": null }],
];

const exportsMap = { ".": "./dist/index.js", "./m": "./dist/m.mjs" };

function fixtureFiles(fixtures: RewriteFixture[]): string[] {
  return fixtures.flatMap(([directory, files]) => files.map(file => `${directory}/${file}`));
}

function fixturePins(fixtures: RewriteFixture[], from: string, prefix: string, base: string): Pin[] {
  return fixtures.flatMap(([directory, , answers]) =>
    Object.entries(answers).map(([specifier, answer]): Pin => [
      from,
      `${prefix}${directory}/${specifier}`,
      answer === null ? null : `${base}${directory}/${answer}`,
    ]),
  );
}

const cases: ResolutionCase[] = [
  {
    name: "outside node_modules",
    files: Object.fromEntries(fixtureFiles(projectFixtures).map(file => [file, ""])),
    pins: fixturePins(projectFixtures, "importer.ts", "./", ""),
  },
  {
    name: "inside node_modules",
    files: packageFiles("pkg", {}, fixtureFiles(nodeModulesFixtures)),
    pins: [
      ...fixturePins(nodeModulesFixtures, "node_modules/pkg/importer.js", "./", "node_modules/pkg/"),
      ...fixturePins(nodeModulesFixtures, "importer.ts", "pkg/", "node_modules/pkg/"),
    ],
  },
  {
    name: "targets of exports",
    files: packageFiles("exported", { exports: exportsMap }, ["dist/index.ts", "dist/m.mts"]),
    pins: [
      ["importer.ts", "exported", "node_modules/exported/dist/index.ts"],
      ["importer.ts", "exported/m", "node_modules/exported/dist/m.mts"],
    ],
  },
  {
    name: "targets of exports, self-reference",
    files: {
      "package.json": JSON.stringify({ name: "self", exports: exportsMap }),
      "dist/index.ts": "",
      "dist/m.mts": "",
    },
    pins: [
      ["src/importer.ts", "self", "dist/index.ts"],
      ["src/importer.ts", "self/m", "dist/m.mts"],
    ],
  },
];

describe("code resolution", () => testResolution(cases));

test("without the aot condition .mjs and .cjs are not rewritten inside node_modules", () => {
  using tree = tempDir("aot-resolver", packageFiles("pkg", {}, ["a.mts", "b.cts", "c.ts"]));
  const resolve = (specifier: string) => Bun.resolveSync(specifier, String(tree)).slice(String(tree).length + 1);
  expect(resolve("pkg/c.js").replaceAll("\\", "/")).toBe("node_modules/pkg/c.ts");
  expect(() => resolve("pkg/a.mjs")).toThrow();
  expect(() => resolve("pkg/b.cjs")).toThrow();
});
