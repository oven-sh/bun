import type { DirectoryTree } from "harness";
import { describe } from "../supported";
import { packageFiles, testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

// Without an answer the resolvers are only compared.
type ManifestFixture = [name: string, text: string, answer?: "main.js" | "index.js"];
type ConfigFixture = [name: string, text: string, answer?: "files/a.ts" | null, specifier?: string];

// "main.js": the text was read. "index.js": the package has no main field.
const manifestFixtures: ManifestFixture[] = [
  ["comments", '// a\n{ /* b */ "main": "./main.js" }', "main.js"],
  ["trailing-comma", '{ "main": "./main.js", }', "main.js"],
  ["duplicate-key", '{ "main": "./main.js", "main": "./other.js" }', "main.js"],
  ["no-bytes", "", "index.js"],
  ["blank", " \n", "index.js"],
  ["unterminated", '{ "main": "./main.js"', "index.js"],
  ["root-array", '["./main.js"]', "index.js"],
  ["root-string", '"./main.js"', "index.js"],
  ["root-number", "5", "index.js"],
  ["root-null", "null", "index.js"],
  ["main-object", '{ "main": {} }', "index.js"],
  ["main-null", '{ "main": null }', "index.js"],
  ["main-true", '{ "main": true }', "index.js"],
  ["name-number", '{ "name": 5, "main": "./main.js" }', "main.js"],
  ["type-number", '{ "type": 5, "main": "./main.js" }', "main.js"],
  ["type-unknown", '{ "type": "esm", "main": "./main.js" }', "main.js"],
  ["text-after", '{ "main": "./main.js" } x'],
  ["byte-order-mark", '\uFEFF{ "main": "./main.js" }'],
  ["escape", '{ "main": "./ma\\u0069n.js" }'],
  ["escaped-key", '{ "ma\\u0069n": "./main.js" }'],
  ["single-quotes", "{ 'main': './main.js' }"],
  ["bare-key", '{ main: "./main.js" }'],
  ["exports-number", '{ "exports": 5, "main": "./main.js" }'],
  ["exports-null", '{ "exports": null, "main": "./main.js" }'],
  ["exports-true", '{ "exports": true, "main": "./main.js" }'],
  ["exports-empty-string", '{ "exports": "", "main": "./main.js" }'],
  ["exports-empty-array", '{ "exports": [], "main": "./main.js" }'],
  ["exports-empty-object", '{ "exports": {}, "main": "./main.js" }'],
  ["imports-number", '{ "imports": 5, "main": "./main.js" }'],
];

function configWithOptions(compilerOptions: string): string {
  return `{ "compilerOptions": ${compilerOptions} }`;
}

function configWithPaths(paths: string): string {
  return configWithOptions(`{ "paths": ${paths} }`);
}

const filesAlias = '"paths": { "@v/*": ["./files/*"] }';

const configFixtures: ConfigFixture[] = [
  ["comments", `// a\n{ /* b */ "compilerOptions": { ${filesAlias}, }, }`, "files/a.ts"],
  ["two-options", `{ "compilerOptions": { ${filesAlias} }, "compilerOptions": {} }`, "files/a.ts"],
  ["two-paths", configWithOptions(`{ ${filesAlias}, "paths": { "@v/*": ["./other/*"] } }`), "files/a.ts"],
  ["mixed-list", configWithPaths('{ "@v/*": [5, null, "./files/*"] }'), "files/a.ts"],
  ["string-value", configWithPaths('{ "@v/*": "./files/*" }'), null],
  ["paths-array", configWithPaths("[]"), null],
  ["options-array", configWithOptions("[]"), null],
  ["two-stars-key", configWithPaths('{ "@v/*/*": ["./files/*"] }'), null, "@v/a/a"],
  ["two-stars-value", configWithPaths('{ "@v/*": ["./*/*"] }'), null],
  ["base-url-number", configWithOptions(`{ "baseUrl": 5, ${filesAlias} }`), "files/a.ts"],
  ["no-bytes", "", null],
  ["blank", " \n", null],
  ["unterminated", '{ "compilerOptions": {', null],
  ["root-array", "[]", null],
  ["repeated-key", configWithPaths('{ "@v/*": ["./other/*"], "@v/*": ["./files/*"] }')],
];

function manifestPin([name, , answer]: ManifestFixture): Pin {
  return answer === undefined ? ["importer.js", name] : ["importer.js", name, `node_modules/${name}/${answer}`];
}

function configFiles([name, text]: ConfigFixture): DirectoryTree {
  return { [`${name}/tsconfig.json`]: text, [`${name}/files/a.ts`]: "", [`${name}/other/a.ts`]: "" };
}

// A tsconfig.json that is a file hides the one above it, whatever its text.
function configPins([name, , answer, specifier = "@v/a"]: ConfigFixture): Pin[] {
  const from = `${name}/importer.ts`;
  const rootAliasPin: Pin = [from, "@root/a", null];
  if (answer === undefined) return [[from, specifier], rootAliasPin];
  return [[from, specifier, answer === null ? null : `${name}/${answer}`], rootAliasPin];
}

const cases: ResolutionCase[] = [
  {
    name: "package.json texts",
    files: Object.assign(
      {},
      ...manifestFixtures.map(([name, text]) => packageFiles(name, text, ["main.js", "other.js", "index.js"])),
    ),
    pins: manifestFixtures.map(manifestPin),
  },
  // A rejected package.json counts as absent. An empty one is "{}".
  {
    name: "the nearest package.json that parses",
    files: {
      "package.json": '{ "name": "root", "imports": { "#x": "./x.js" } }',
      "x.js": "",
      "broken/package.json": '{ "imports": ',
      "valid/package.json": "{}",
      "no-bytes/package.json": "",
    },
    pins: [
      ["broken/importer.js", "#x", "x.js"],
      ["valid/importer.js", "#x", null],
      ["no-bytes/importer.js", "#x", null],
    ],
  },
  {
    name: "tsconfig.json texts",
    files: Object.assign(
      {
        "tsconfig.json": configWithPaths('{ "@root/*": ["./src/*"] }'),
        "src/a.ts": "",
        "two-stars-value/a/a.ts": "",
        "unterminated/jsconfig.json": configWithPaths('{ "@js/*": ["./files/*"] }'),
        "directory/tsconfig.json/keep.txt": "",
      },
      ...configFixtures.map(configFiles),
    ),
    pins: [
      ...configFixtures.flatMap(configPins),
      ["unterminated/importer.ts", "@js/a", null],
      ["directory/importer.ts", "@root/a", "src/a.ts"],
    ],
  },
];

describe("code resolution", () => testResolution(cases));
