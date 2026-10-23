import { isWindows, type DirectoryTree } from "harness";
import { join } from "node:path";
import { describe } from "../supported";
import { testResolution, type Pin, type ResolutionCase } from "./resolution-cases";

type Answer = string | null | [onImport: string, onRequire: string];
// undefined: the resolvers are only compared.
type AnswersBySpecifier = Record<string, Answer | undefined>;
type KeyFixture = [specifier: string, answer: string | null, decoys?: string[]];
type ExtendsFixture = [directory: string, config: object, answers: AnswersBySpecifier];

interface ConfigCase {
  name: string;
  configs: Record<string, string>;
  answersByImporter: Record<string, AnswersBySpecifier>;
  decoys?: string[];
  child?: ResolutionCase["child"];
}

function configWithOptions(compilerOptions: object): string {
  return JSON.stringify({ compilerOptions });
}

function configWithPaths(paths: Record<string, string[]>): string {
  return configWithOptions({ paths });
}

const keyPaths = {
  "exact": ["./src/exact.ts"],
  "exact/*": ["./src/under-exact/*"],
  "@/*": ["./src/*"],
  "@/deep/*": ["./src/deeper/*"],
  "pre-*-post": ["./src/middle/*.ts"],
  "pre-*": ["./src/prefix/*"],
  "fallback/*": ["./missing/*", "./src/second/*"],
  "types-only": ["./src/types-only.d.ts", "./src/types-only-code.ts"],
  "exact-missing": ["./missing.ts"],
  "exact-*": ["./src/exact-star/*"],
  "pkg/*": ["./nowhere/*"],
  "dir": ["./src/dir"],
  "js-extension": ["./src/real.js"],
  "bare/*": ["src/*"],
  "~*": ["./src/*"],
};

const keyFixtures: KeyFixture[] = [
  ["exact", "src/exact.ts", ["node_modules/exact/index.js"]],
  ["exact/a", "src/under-exact/a.ts"],
  ["@/a", "src/a.ts"],
  ["bare/a", "src/a.ts"],
  // One pattern is tried: the longest prefix wins, then the longest suffix.
  ["@/deep/a", "src/deeper/a.ts", ["src/deep/a.ts"]],
  ["@/deep/shallow", null, ["src/deep/shallow.ts"]],
  ["pre-x-post", "src/middle/x.ts", ["src/prefix/x-post.ts"]],
  ["pre-y", "src/prefix/y.ts"],
  ["fallback/a", "src/second/a.ts"],
  // A substitution written as a declaration file is skipped. A specifier that names one is not.
  ["types-only", "src/types-only-code.ts", ["src/types-only.d.ts"]],
  ["@/env.d.ts", "src/env.d.ts"],
  // When no substitution loads, an exact key falls through to the patterns, and the patterns to node_modules.
  ["exact-missing", "src/exact-star/missing.ts"],
  ["pkg/a", "node_modules/pkg/a.js"],
  ["dir", "src/dir/index.ts"],
  ["js-extension", "src/real.ts"],
  // After a trailing "/" no extension is added.
  ["@/both", "src/both.ts"],
  // TODO: on Windows `bun run` loses the "/" and takes src/both.ts.
  ...((isWindows ? [] : [["@/both/", "src/both/index.ts"]]) as KeyFixture[]),
];

const baseConfig = configWithPaths({ "@base/*": ["./from-base/*"] });
const ownOptions = { paths: { "@own/*": ["./own/*"] } };

const extendsFixtures: ExtendsFixture[] = [
  ["inherits", { extends: "../config/base.json" }, { "@base/a": "config/from-base/a.ts" }],
  [
    "replaces",
    { extends: "../config/base.json", compilerOptions: ownOptions },
    { "@own/a": "replaces/own/a.ts", "@base/a": null },
  ],
  ["clears", { extends: "../config/base.json", compilerOptions: { paths: {} } }, { "@base/a": null }],
  [
    "rebases",
    { extends: "../config/base.json", compilerOptions: { baseUrl: "./root" } },
    { "@base/a": "rebases/root/from-base/a.ts" },
  ],
  ["chain", { extends: "../inherits/tsconfig.json" }, { "@base/a": "config/from-base/a.ts" }],
  // Unlike tsc: ".json" is not appended, a list is ignored, node_modules is not searched.
  ["no-extension", { extends: "../config/base" }, { "@base/a": null }],
  ["list", { extends: ["../config/base.json"] }, { "@base/a": null }],
  ["package", { extends: "shared/tsconfig.json" }, { "@base/a": null }],
  ["missing", { extends: "./none.json", compilerOptions: ownOptions }, { "@own/a": "missing/own/a.ts" }],
];

const rootConfig = configWithPaths({ "@root/*": ["./src/*"] });
const nestedConfig = configWithPaths({ "@nested/*": ["./files/*"] });
const siblingConfig = configWithPaths({ "@/*": ["./src/*"] });
const javaScriptConfig = configWithPaths({ "@js/*": ["./files/*"] });
const packageConfig = configWithPaths({ "@own/*": ["./lib/*"] });

function createOverrideCase(name: string, configPath: string, overridePath: string): ConfigCase {
  const answers = { "@override/a": "elsewhere/files/a.ts", "@root/a": null, "@nested/a": null };
  return {
    name,
    configs: {
      "tsconfig.json": rootConfig,
      "nested/tsconfig.json": nestedConfig,
      [configPath]: configWithPaths({ "@override/*": ["./files/*"] }),
    },
    answersByImporter: { "importer.ts": answers, "nested/importer.ts": answers },
    decoys: ["src/a.ts", "nested/files/a.ts"],
    child: root => ({ args: ["--tsconfig-override", join(root, overridePath)] }),
  };
}

const cases: ConfigCase[] = [
  {
    name: "keys",
    configs: { "tsconfig.json": configWithOptions({ baseUrl: ".", paths: keyPaths }) },
    answersByImporter: {
      "app/importer.ts": {
        ...Object.fromEntries(keyFixtures.map(([specifier, answer]) => [specifier, answer])),
        "~/a": undefined,
        "./exact": undefined,
      },
    },
    decoys: keyFixtures.flatMap(([, , decoys = []]) => decoys),
  },
  {
    name: "baseUrl",
    configs: { "tsconfig.json": configWithOptions({ baseUrl: "./src" }) },
    answersByImporter: {
      "importer.ts": {
        "lib/a": "src/lib/a.ts",
        "lib/b": ["src/lib/b.mjs", "src/lib/b.cjs"],
        "installed": "node_modules/installed/index.js",
      },
    },
    decoys: ["node_modules/lib/a.js"],
  },
  {
    name: "paths without baseUrl",
    configs: { "tsconfig.json": configWithPaths({ "@/*": ["./src/*"], "bare/*": ["src/*"] }) },
    answersByImporter: { "importer.ts": { "@/a": "src/a.ts", "bare/a": null } },
  },
  {
    name: "extends",
    configs: {
      "config/base.json": baseConfig,
      "node_modules/shared/tsconfig.json": baseConfig,
      ...Object.fromEntries(
        extendsFixtures.map(([directory, config]) => [`${directory}/tsconfig.json`, JSON.stringify(config)]),
      ),
    },
    answersByImporter: Object.fromEntries(
      extendsFixtures.map(([directory, , answers]) => [`${directory}/importer.ts`, answers]),
    ),
    decoys: ["node_modules/shared/from-base/a.ts"],
  },
  // Unlike tsc: ${configDir} is the directory of the file that contains it, not of the file that extends it.
  // An absolute substitution of an exact key is loaded as written: "dot/." is a directory, never dot.ts.
  {
    name: "configDir",
    configs: {
      "config/base.json": configWithPaths({ "@cfg/*": ["${configDir}/src/*"], "@cfg-dot": ["${configDir}/dot/."] }),
      "app/tsconfig.json": JSON.stringify({ extends: "../config/base.json" }),
      "own/tsconfig.json": configWithOptions({ baseUrl: "${configDir}/src" }),
    },
    answersByImporter: {
      "app/importer.ts": { "@cfg/a": "config/src/a.ts", "@cfg-dot": "config/dot/index.ts" },
      "own/importer.ts": { "b": "own/src/b.ts" },
    },
    decoys: ["app/src/a.ts", "config/dot.ts"],
  },
  {
    name: "jsconfig.json",
    configs: {
      "only/jsconfig.json": javaScriptConfig,
      "both/jsconfig.json": javaScriptConfig,
      "both/tsconfig.json": configWithOptions({}),
    },
    answersByImporter: {
      "only/importer.js": { "@js/a": "only/files/a.js" },
      "both/importer.js": { "@js/a": null },
    },
    decoys: ["both/files/a.js"],
  },
  {
    name: "nested and sibling",
    configs: {
      "tsconfig.json": rootConfig,
      "nested/tsconfig.json": nestedConfig,
      "left/tsconfig.json": siblingConfig,
      "right/tsconfig.json": siblingConfig,
    },
    answersByImporter: {
      "nested/importer.ts": { "@nested/a": "nested/files/a.ts", "@root/a": null },
      "nested/deeper/importer.ts": { "@nested/a": "nested/files/a.ts", "@root/a": null },
      "plain/importer.ts": { "@root/a": "src/a.ts" },
      "left/importer.ts": { "@/a": "left/src/a.ts" },
      "right/importer.ts": { "@/a": "right/src/a.ts" },
    },
  },
  // A tsconfig.json inside node_modules is read, but its "extends" is not.
  {
    name: "inside node_modules",
    configs: {
      "tsconfig.json": rootConfig,
      "node_modules/own/tsconfig.json": packageConfig,
      "node_modules/extending/tsconfig.json": JSON.stringify({ extends: "./base.json" }),
      "node_modules/extending/base.json": packageConfig,
    },
    answersByImporter: {
      "node_modules/own/importer.js": { "@own/a": "node_modules/own/lib/a.js", "@root/a": null },
      "node_modules/extending/importer.js": { "@own/a": null },
      "node_modules/plain/importer.js": { "@root/a": "src/a.ts" },
    },
    decoys: ["node_modules/extending/lib/a.js"],
  },
  createOverrideCase("--tsconfig-override, a file", "elsewhere/custom.json", "elsewhere/custom.json"),
  createOverrideCase("--tsconfig-override, a directory", "elsewhere/tsconfig.json", "elsewhere"),
];

function createPins(answersByImporter: ConfigCase["answersByImporter"]): Pin[] {
  return Object.entries(answersByImporter).flatMap(([from, answers]) =>
    Object.entries(answers).map(([specifier, answer]): Pin => {
      if (answer === undefined) return [from, specifier];
      return Array.isArray(answer) ? [from, specifier, ...answer] : [from, specifier, answer];
    }),
  );
}

function createCase({ name, configs, answersByImporter, decoys = [], child }: ConfigCase): ResolutionCase {
  const pins = createPins(answersByImporter);
  const files: DirectoryTree = {};
  for (const [, , ...answers] of pins) {
    for (const answer of answers) {
      if (typeof answer === "string") files[answer] = "";
    }
  }
  for (const decoy of decoys) files[decoy] = "";
  return { name, files: { ...files, ...configs }, pins, child };
}

describe("code resolution", () => testResolution(cases.map(createCase)));
