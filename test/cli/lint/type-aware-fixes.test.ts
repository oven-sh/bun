// What `--fix` writes for a rule that needs types, where the answer takes a project: a global that another file declares,
// an import, two blocks of one namespace. The cases that the rules' own test suites record are single files.
import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined, NO_COLOR: "1" };

async function run(cwd: string, args: string[]) {
  await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const eslintConfig = `export default [{
  files: ["**/*.ts"],
  plugins: { "@typescript-eslint": { meta: { name: "@typescript-eslint/eslint-plugin" } } },
  languageOptions: { parser: { meta: { name: "typescript-eslint/parser" } }, parserOptions: { projectService: true } },
  rules: { "@typescript-eslint/prefer-readonly": "error" },
}];
`;
const oxlintConfig = JSON.stringify({
  plugins: ["typescript"],
  categories: { correctness: "off" },
  rules: { "typescript/prefer-readonly": "error" },
});
const configs: [name: string, files: Record<string, string>, flags: string[]][] = [
  ["an oxlint config", { ".oxlintrc.json": oxlintConfig }, ["--type-aware"]],
  ["an ESLint config", { "eslint.config.js": eslintConfig }, []],
  ["no config", {}, ["--type-aware", "--rule", "@typescript-eslint/prefer-readonly: error"]],
];
const tsconfig = (compilerOptions: object = {}) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      lib: ["esnext"],
      types: [],
      ...compilerOptions,
    },
  });

/**
 * A class with a member that starts as `first`, and that its constructor alone assigns, to `second`.
 * `declared`: how the member is declared, up to its `=`.
 */
function holder(first: string, second: string, declared = "private current") {
  const name = /#?current/.exec(declared)![0];
  return [
    "export class Holder {",
    `  ${declared} = ${first};`,
    "  constructor(other: boolean) {",
    `    if (other) this.${name} = ${second};`,
    "  }",
    "  get value() {",
    `    return this.${name};`,
    "  }",
    "}",
    "",
  ].join("\n");
}

// prefer-readonly: `readonly` keeps the type of the initializer, which is the one member `Level.Debug`. The constructor assigns
// another member, so the fix has to write the type of the enum, and it may only write a name that means the enum there.
const project = {
  "tsconfig.json": tsconfig(),
  "globals.d.ts": "declare enum Level {\n  Debug = 0,\n  Info = 1,\n}\ndeclare enum Raw {\n  A,\n  B,\n}\n",
  // A script: what it declares is global.
  "phase.ts": "enum Phase {\n  Idle,\n  Busy,\n}\n",
  "shape.ts": [
    "enum Shape {\n  Round,\n  Square,\n}\nexport default Shape;\n",
    "export enum Color {\n  Red,\n  Green,\n}\n",
    "export namespace Ui {\n  export enum Range {\n    Low,\n    High,\n  }\n}\n",
  ].join(""),
};

const declaresGlobal = "declare global {\n  enum Mode {\n    Off = 0,\n    On = 1,\n  }\n}\n";
const firstBlock = "export namespace Panel {\n  export enum Side {\n    Left,\n    Right,\n  }\n}\n";
const importsUi = 'import { Ui } from "./shape";\n';
// The function has a value `Color`. As a type, `Color` is still the enum.
const besideAValue = (declared: string) =>
  [
    'import { Color } from "./shape";',
    "const red = Color.Red;",
    "const green = Color.Green;",
    "export function make() {",
    "  const Color = 1;",
    "  class Holder {",
    `    ${declared} = red;`,
    "    constructor(other: boolean) {",
    "      if (other) this.current = green;",
    "    }",
    "    get value() {",
    "      return [this.current, Color];",
    "    }",
    "  }",
    "  return Holder;",
    "}",
    "",
  ].join("\n");
// `Level` is the type parameter here, so the enum has no name. The constructor assigns `assigned`.
const underATypeParameter = (declared: string, assigned: string) =>
  [
    "const debug = Level.Debug;",
    "const info = Level.Info;",
    "export class Holder<Level> {",
    `  ${declared} = debug;`,
    "  constructor(public other: Level) {",
    `    this.current = ${assigned};`,
    "  }",
    "  get value() {",
    "    return [this.current, info];",
    "  }",
    "}",
    "",
  ].join("\n");
// In the second block `Tone` is the `number` of the first.
const besideATypeOfAnotherBlock = (declared: string) =>
  [
    'enum Tone {\n  Low = "l",\n  High = "h",\n}',
    "const low = Tone.Low;",
    "export namespace Sound {\n  export type Tone = number;\n}",
    `export namespace Sound {\n${holder("low", "low", declared)}}`,
    "",
  ].join("\n");
// `Color<T>` is the enum, and `Color` without an argument is no type.
const besideAGenericAlias = (declared: string) =>
  [
    'import * as shape from "./shape";',
    "export type Color<T> = shape.Color;",
    holder("shape.Color.Red", "shape.Color.Red", declared),
  ].join("\n");
// A static member and a member of an instance have one name. The constructor assigns the member of the instance.
const besideAStaticMember = (ofTheClass: string, ofAnInstance: string) =>
  [
    importsUi.trimEnd(),
    "export class Holder {",
    `  ${ofTheClass} = Ui.Range.Low;`,
    `  ${ofAnInstance} = Ui.Range.Low;`,
    "  constructor(other: boolean) {",
    "    if (other) this.current = Ui.Range.High;",
    "  }",
    "  get value() {",
    "    return [this.current, Holder.current];",
    "  }",
    "}",
    "",
  ].join("\n");
// The constructor assigns through `pattern`. What a pattern writes is not the value of the default.
const defaultInAPattern = (declared: string, options: string, pattern: string) =>
  [
    importsUi.trimEnd(),
    "export class Holder {",
    `  ${declared} = Ui.Range.Low;`,
    `  constructor(options: ${options}) {`,
    `    (${pattern} = options);`,
    "  }",
    "  get value() {",
    "    return this.current;",
    "  }",
    "}",
    "",
  ].join("\n");
const flat = ["{ current?: Ui.Range }", "{ current: this.current = Ui.Range.Low }"] as const;
const nested = ["{ inner: { current?: Ui.Range } }", "{ inner: { current: this.current = Ui.Range.Low } }"] as const;
// The constructor copies the member from another instance, whose member is narrowed as well.
const copiedFromAnInstance = (declared: string) =>
  [
    importsUi.trimEnd(),
    "export class Holder {",
    `  ${declared} = Ui.Range.Low;`,
    "  constructor(from?: Holder) {",
    "    if (from) this.current = from.current;",
    "  }",
    "  get value() {",
    "    return this.current;",
    "  }",
    "}",
    "",
  ].join("\n");

/** The file, its text, and what `--fix` makes of it. */
const written: [file: string, source: string, fixed: string][] = [
  [
    "global-in-a-declaration-file.ts",
    holder("Level.Debug", "Level.Info"),
    holder("Level.Debug", "Level.Info", "private readonly current: Level"),
  ],
  // typescript-eslint and tsgolint write no type for an enum whose members have no values.
  [
    "global-without-initializers.ts",
    holder("Raw.A", "Raw.B"),
    holder("Raw.A", "Raw.B", "private readonly current: Raw"),
  ],
  [
    "global-of-a-script.ts",
    holder("Phase.Idle", "Phase.Busy"),
    holder("Phase.Idle", "Phase.Busy", "private readonly current: Phase"),
  ],
  [
    "declare-global.ts",
    declaresGlobal + holder("Mode.Off", "Mode.On"),
    declaresGlobal + holder("Mode.Off", "Mode.On", "private readonly current: Mode"),
  ],
  [
    "default-import.ts",
    'import Shape from "./shape";\n' + holder("Shape.Round", "Shape.Square"),
    'import Shape from "./shape";\n' + holder("Shape.Round", "Shape.Square", "private readonly current: Shape"),
  ],
  [
    "named-import.ts",
    'import { Color } from "./shape";\n' + holder("Color.Red", "Color.Green"),
    'import { Color } from "./shape";\n' + holder("Color.Red", "Color.Green", "private readonly current: Color"),
  ],
  [
    "import-equals.ts",
    `${importsUi}import Range = Ui.Range;\n${holder("Range.Low", "Range.High")}`,
    `${importsUi}import Range = Ui.Range;\n${holder("Range.Low", "Range.High", "private readonly current: Range")}`,
  ],
  [
    "another-block-of-the-namespace.ts",
    `${firstBlock}export namespace Panel {\n${holder("Side.Left", "Side.Right")}}\n`,
    `${firstBlock}export namespace Panel {\n${holder("Side.Left", "Side.Right", "private readonly current: Side")}}\n`,
  ],
  [
    "private-name.ts",
    holder("Level.Debug", "Level.Info", "#current"),
    holder("Level.Debug", "Level.Info", "readonly #current: Level"),
  ],
  ["beside-a-value-of-that-name.ts", besideAValue("private current"), besideAValue("private readonly current: Color")],
  // The type goes after the `?`. typescript-eslint and tsgolint write it before, which doesn't parse.
  [
    "optional.ts",
    holder("1", "2", "private current?"),
    holder("1", "2", "private readonly current?: number | undefined"),
  ],
  // No name means the enum where the member is. The constructor assigns the same member, so `readonly` alone is right.
  [
    "type-parameter-of-that-name.ts",
    underATypeParameter("private current", "debug"),
    underATypeParameter("private readonly current", "debug"),
  ],
  [
    "type-of-that-name-in-another-block.ts",
    besideATypeOfAnotherBlock("private current"),
    besideATypeOfAnotherBlock("private readonly current"),
  ],
  [
    "generic-alias-of-that-name.ts",
    besideAGenericAlias("private current"),
    besideAGenericAlias("private readonly current"),
  ],
  [
    "name-that-is-not-in-scope.ts",
    importsUi + holder("Ui.Range.Low", "Ui.Range.Low"),
    importsUi + holder("Ui.Range.Low", "Ui.Range.Low", "private readonly current"),
  ],
  // An optional member takes the `undefined` that the constructor assigns.
  [
    "optional-that-is-reset.ts",
    importsUi + holder("Ui.Range.Low", "undefined", "private current?"),
    importsUi + holder("Ui.Range.Low", "undefined", "private readonly current?"),
  ],
  [
    "copied-from-an-instance.ts",
    copiedFromAnInstance("private current"),
    copiedFromAnInstance("private readonly current"),
  ],
];

/**
 * The file, its text, and what only `--fix-dangerously` makes of it. No type can be written, and the constructor assigns what
 * the type of the initializer doesn't take, so `readonly` alone breaks the type check. `fixed`: what `--fix` makes of the file,
 * if it changes another member.
 */
const heldBack: [file: string, source: string, dangerously: string, fixed?: string][] = [
  [
    "held-back-name-that-is-not-in-scope.ts",
    importsUi + holder("Ui.Range.Low", "Ui.Range.High"),
    importsUi + holder("Ui.Range.Low", "Ui.Range.High", "private readonly current"),
  ],
  [
    "held-back-type-parameter-of-that-name.ts",
    underATypeParameter("private current", "info"),
    underATypeParameter("private readonly current", "info"),
  ],
  [
    "held-back-union.ts",
    holder('Math.random() > 0.5 ? "a" : "b"', '"c"'),
    holder('Math.random() > 0.5 ? "a" : "b"', '"c"', "private readonly current"),
  ],
  // Its type is `Level | undefined`, which is no name.
  [
    "held-back-optional.ts",
    holder("Level.Debug", "Level.Info", "private current?"),
    holder("Level.Debug", "Level.Info", "private readonly current?"),
  ],
  [
    "held-back-default-in-a-pattern.ts",
    defaultInAPattern("private current", ...flat),
    defaultInAPattern("private readonly current", ...flat),
  ],
  [
    "held-back-default-in-a-nested-pattern.ts",
    defaultInAPattern("private current", ...nested),
    defaultInAPattern("private readonly current", ...nested),
  ],
  // No write of the constructor reaches the static member, so `--fix` makes that one `readonly`.
  [
    "held-back-beside-a-static-member.ts",
    besideAStaticMember("private static current", "private current"),
    besideAStaticMember("private static readonly current", "private readonly current"),
    besideAStaticMember("private static readonly current", "private current"),
  ],
];

const textsOf = (cwd: string, files: string[]) =>
  Object.fromEntries(files.map(file => [file, readFileSync(join(cwd, file), "utf8")]));
/** The codes of the errors that `bun check` printed, by file. */
const errorsOf = (stdout: string) => {
  const errors: Record<string, string[]> = {};
  for (const [, file, code] of stdout.matchAll(/^(.+)\(\d+,\d+\): error (TS\d+):/gm)) (errors[file] ??= []).push(code);
  return errors;
};
const timeout = isDebug || isASAN ? 120_000 : 30_000;

test.concurrent.each(configs)(
  "prefer-readonly writes the type of an enum that the type checker finds, and the project still type checks, with %s",
  async (_, config, flags) => {
    const rows = [...written, ...heldBack];
    const sources = Object.fromEntries(rows.map(([file, source]) => [file, source]));
    using dir = tempDir("lint-type-aware-fixes", { ...project, ...sources, ...config });
    const cwd = String(dir);

    const lint = await run(cwd, ["lint", "--fix", ...flags, "."]);
    expect(textsOf(cwd, Object.keys(sources))).toEqual({
      ...Object.fromEntries(written.map(([file, , fixed]) => [file, fixed])),
      ...Object.fromEntries(heldBack.map(([file, source, , fixed = source]) => [file, fixed])),
    });
    // `bun check` prints its errors on stdout. The members that are held back are still reported.
    const check = await run(cwd, ["check"]);
    expect(check.stdout).toBe("");
    expect({ lint: lint.exitCode, check: check.exitCode }).toEqual({ lint: 1, check: 0 });

    // With `readonly` alone, each file that was held back has the error that it was held back for, and no other file has one.
    const forced = await run(cwd, ["lint", "--fix-dangerously", ...flags, "."]);
    const held = heldBack.map(([file]) => file);
    expect(textsOf(cwd, held)).toEqual(
      Object.fromEntries(heldBack.map(([file, , dangerously]) => [file, dangerously])),
    );
    const broken = await run(cwd, ["check"]);
    expect(errorsOf(broken.stdout)).toEqual(Object.fromEntries(held.map(file => [file, ["TS2322"]])));
    expect({ lint: forced.exitCode, check: broken.exitCode }).toEqual({ lint: 0, check: 1 });
  },
  timeout,
);

test.concurrent.each(configs)(
  "prefer-readonly writes the type of an optional member after its `?`, without strictNullChecks and with %s",
  async (_, config, flags) => {
    const files = {
      "tsconfig.json": tsconfig({ strictNullChecks: false }),
      "globals.d.ts": project["globals.d.ts"],
      "optional.ts": holder("Level.Debug", "Level.Info", "private current?"),
    };
    using dir = tempDir("lint-type-aware-fixes", { ...files, ...config });
    const cwd = String(dir);

    const lint = await run(cwd, ["lint", "--fix", ...flags, "."]);
    expect(readFileSync(join(cwd, "optional.ts"), "utf8")).toBe(
      holder("Level.Debug", "Level.Info", "private readonly current?: Level"),
    );
    const check = await run(cwd, ["check"]);
    expect(check.stdout).toBe("");
    expect({ lint: lint.exitCode, check: check.exitCode }).toEqual({ lint: 0, check: 0 });
  },
  timeout,
);
