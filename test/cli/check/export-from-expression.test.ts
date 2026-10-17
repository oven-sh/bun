// An export declaration whose module specifier is no string: `export *`, `export * from ("./m")`, `export * from (a +`.
// tsc emits declarations after syntax errors too (`EmitFilesAndReportErrors`), so the declaration transformer reads
// what the parser recovered. What it emits for such a declaration is what a project that references this one parses:
// where an error is in that declaration file shows what text it has. differential-cases.json has the same programs
// for tsc itself to be asked.
//
// In a file of its own, with projects that load no library: `bun bd test` of it then passes within the five seconds
// that a test has by default, which the project references of check.test.ts do not in a debug build.
import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { endChildren, spawn } from "../children";
import { env } from "./differential";

afterAll(endChildren);

type Files = Record<string, string>;

async function run(cwd: string, cmd: string[]) {
  await using proc = spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const clean = (text: string) =>
    text
      .replaceAll("\\", "/")
      .replaceAll(cwd.replaceAll("\\", "/"), "<dir>")
      .replace(/\[\d+(\.\d+)?m?s\]/g, "[time]")
      .trim();
  return { raw: stdout, stdout: clean(stdout), stderr: clean(stderr), exitCode };
}
const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);

// Instead of the library files, which a debug build takes seconds to read.
const globals =
  "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String"
    .split(" ")
    .map(name => `interface ${name} {}\n`)
    .join("") + `declare var console: { log(...args: unknown[]): void };\n`;
const options = {
  strict: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  noLib: true,
  types: [],
  skipLibCheck: true,
};
const config = (more: object = {}, rest: object = {}) =>
  JSON.stringify({ compilerOptions: { ...options, ...more }, ...rest });
const project = (files: Files) => tempDir("bun-check-export-from", { "globals.d.ts": globals, ...files });

// `lib` has a file for each text and `app` imports them all, so `app` reads the declaration file of each.
const referenced = (texts: Files): Files => ({
  "tsconfig.json": `{ "files": [], "references": [{ "path": "./lib" }, { "path": "./app" }] }`,
  "lib/tsconfig.json": config({ composite: true }),
  "lib/globals.d.ts": globals,
  "lib/m.ts": `export const a = 1;\n`,
  ...Object.fromEntries(Object.entries(texts).map(([name, text]) => [`lib/${name}.ts`, text])),
  "app/tsconfig.json": config({ composite: true }, { references: [{ path: "../lib" }] }),
  "app/globals.d.ts": globals,
  "app/main.ts": `${Object.keys(texts)
    .map(name => `import "../lib/${name}";\n`)
    .join("")}export const planted: number = "x";\n`,
});

const none: Files = {
  star: `export *\n`,
  namespace: `export * as ns from\r\n`,
  named: `export { a } from // which module\n`,
  type: `export type *\n`,
  between: `export const b = 1;\nexport * from\nexport const c = 2;\n`,
};

// What tsc 7.0.2 prints for the files, with the arguments.
const cases: Record<string, { args?: string[]; files: Files; stdout: string[] }> = {
  "no module specifier, where declarations are emitted": {
    files: {
      "tsconfig.json": config({ noEmit: true, declaration: true, allowJs: true }),
      "m.ts": `export const a = 1;\n`,
      "from.ts": `export * from\n`,
      // Its parentheses hold a cast, and the cast nothing.
      "cast.js": `export * from /** @type {any} */ ( )\n`,
      ...Object.fromEntries(Object.entries(none).map(([name, text]) => [`${name}.ts`, text])),
    },
    stdout: [
      "between.ts(3,1): error TS1109: Expression expected.",
      "cast.js(1,36): error TS1109: Expression expected.",
      "from.ts(1,14): error TS1109: Expression expected.",
      "named.ts(1,18): error TS1109: Expression expected.",
      "namespace.ts(1,20): error TS1109: Expression expected.",
      "star.ts(1,9): error TS1109: Expression expected.",
      "star.ts(2,1): error TS1005: 'from' expected.",
      "type.ts(1,14): error TS1109: Expression expected.",
      "type.ts(2,1): error TS1005: 'from' expected.",
    ],
  },
  // `export * from ;`
  "no module specifier, in a referenced project": {
    args: ["-b"],
    files: referenced(none),
    stdout: [
      "lib/between.ts(3,1): error TS1109: Expression expected.",
      "lib/named.ts(1,18): error TS1109: Expression expected.",
      "lib/namespace.ts(1,20): error TS1109: Expression expected.",
      "lib/star.ts(1,9): error TS1109: Expression expected.",
      "lib/star.ts(2,1): error TS1005: 'from' expected.",
      "lib/type.ts(1,14): error TS1109: Expression expected.",
      "lib/type.ts(2,1): error TS1005: 'from' expected.",
      "lib/between.d.ts(2,15): error TS1109: Expression expected.",
      "lib/named.d.ts(1,19): error TS1109: Expression expected.",
      "lib/namespace.d.ts(1,21): error TS1109: Expression expected.",
      "lib/star.d.ts(1,15): error TS1109: Expression expected.",
      "lib/type.d.ts(1,20): error TS1109: Expression expected.",
    ],
  },
  // `export * from ("./m");`: the parentheses are written, the closing ones too where the source has none. No
  // declaration file has an error, so `app` is checked.
  "a module specifier in parentheses, in a referenced project": {
    args: ["-b"],
    files: referenced({
      closed: `export * from ("./m")\n`,
      nested: `export { a } from ((  "./m"  ));\n`,
      open: `export * from ("./m"\n`,
      half: `export * from (("./m")\n`,
      lines: `export * from (\n  "./m" // the module\n)\n`,
      operand: `export * from (1 + (2))\n`,
    }),
    stdout: [
      "lib/half.ts(2,1): error TS1005: ')' expected.",
      "lib/open.ts(2,1): error TS1005: ')' expected.",
      "app/main.ts(7,14): error TS2322: Type 'string' is not assignable to type 'number'.",
    ],
  },
  // `export * from ();`, and what the source has between an expression and the `)` after it: the line of that `)`.
  "parentheses with an expression that is not whole, in a referenced project": {
    args: ["-b"],
    files: referenced({
      empty: `export * from ()\n`,
      twice: `export * from (())\n`,
      comment: `export * from ( /* none */ )\n`,
      open: `export * from (\n`,
      binary: `export * from (a +\n)\n`,
      space: `export * from (a + )\n`,
      comma: `export * from (a,\n)\n`,
      dot: `export * from (a.\n)\n`,
      half: `export * from ((a +\n)\n`,
      arrow: `export * from (x => a +\n)\n`,
      block: `declare module "x" {\n    export * from (a.\n    )\n}\n`,
    }),
    stdout: [
      "lib/arrow.ts(2,1): error TS1109: Expression expected.",
      "lib/binary.ts(2,1): error TS1109: Expression expected.",
      "lib/block.ts(3,5): error TS1003: Identifier expected.",
      "lib/comma.ts(2,1): error TS1109: Expression expected.",
      "lib/comment.ts(1,28): error TS1109: Expression expected.",
      "lib/dot.ts(2,1): error TS1003: Identifier expected.",
      "lib/empty.ts(1,16): error TS1109: Expression expected.",
      "lib/half.ts(2,1): error TS1109: Expression expected.",
      "lib/half.ts(3,1): error TS1005: ')' expected.",
      "lib/open.ts(1,16): error TS1109: Expression expected.",
      "lib/open.ts(2,1): error TS1005: ')' expected.",
      "lib/space.ts(1,20): error TS1109: Expression expected.",
      "lib/twice.ts(1,17): error TS1109: Expression expected.",
      "lib/arrow.d.ts(2,1): error TS1109: Expression expected.",
      "lib/binary.d.ts(2,1): error TS1109: Expression expected.",
      "lib/block.d.ts(3,5): error TS1003: Identifier expected.",
      "lib/comma.d.ts(2,1): error TS1109: Expression expected.",
      "lib/comment.d.ts(1,16): error TS1109: Expression expected.",
      "lib/dot.d.ts(2,1): error TS1003: Identifier expected.",
      "lib/empty.d.ts(1,16): error TS1109: Expression expected.",
      "lib/half.d.ts(2,1): error TS1109: Expression expected.",
      "lib/open.d.ts(1,16): error TS1109: Expression expected.",
      "lib/space.d.ts(1,20): error TS1109: Expression expected.",
      "lib/twice.d.ts(1,17): error TS1109: Expression expected.",
    ],
  },
};

describe.concurrent("bun check", () => {
  test.each(Object.entries(cases))("%s", async (_, { args = [], files, stdout }) => {
    using dir = project(files);
    const ours = await run(String(dir), [bunExe(), "check", ...args]);
    expect({ stdout: lines(ours.stdout), exitCode: ours.exitCode }).toEqual({ stdout, exitCode: 1 });
  });
});

// types.ts is imported for its types alone, so only the type checker reads it: the bundler does not parse it.
const halfWritten: Files = {
  "tsconfig.json": config({ noEmit: true, declaration: true }),
  "types.ts": `export type T = number;\nexport *\n`,
  "main.ts": `import type { T } from "./types";\nconst t: T = 1;\nconsole.log("it ran", t);\n`,
};

describe.concurrent("--check", () => {
  test("bun --check does not run the file", async () => {
    using dir = project(halfWritten);
    const { stdout, stderr, exitCode } = await run(String(dir), [bunExe(), "--check", "main.ts"]);
    expect({ stdout, stderr: lines(stderr), exitCode }).toEqual({
      stdout: "",
      stderr: [
        "types.ts(2,9): error TS1109: Expression expected.",
        "types.ts(3,1): error TS1005: 'from' expected.",
        "note: Stopped before type checking 2 files. Fix the errors above to see the rest.",
        "Found 2 errors in 1 file, checked 0 files [time]",
      ],
      exitCode: 1,
    });
  });

  test("bun build --check writes nothing", async () => {
    using dir = project(halfWritten);
    const { stdout, stderr, exitCode } = await run(String(dir), [
      bunExe(),
      "build",
      "--check",
      "main.ts",
      "--outdir",
      "out",
    ]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: `2 | export *
            ^
error: TS1109: Expression expected.
    at <dir>/types.ts:2:9

error: TS1005: 'from' expected.
    at <dir>/types.ts:3:1`,
      exitCode: 1,
    });
    expect(await Bun.file(join(String(dir), "out", "main.js")).exists()).toBe(false);
  });

  test("Bun.build({ check: true }) has them among its errors, and the script goes on", async () => {
    using dir = project({
      ...halfWritten,
      "build.mjs": `
        const result = await Bun.build({ entrypoints: ["main.ts"], outdir: "out", check: true, throw: false });
        const logs = result.logs.map(log => [log.level, log.message, log.position?.line, log.position?.column]);
        console.log(JSON.stringify({ success: result.success, outputs: result.outputs.length, logs }));
      `,
    });
    const { raw, exitCode } = await run(String(dir), [bunExe(), "build.mjs"]);
    expect(JSON.parse(raw)).toEqual({
      success: false,
      outputs: 0,
      logs: [
        ["error", "TS1109: Expression expected.", 2, 9],
        ["error", "TS1005: 'from' expected.", 3, 1],
      ],
    });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("bun lint --type-aware --type-check", () => {
  // The parser of the linter reports the line as well.
  test("the errors of the type checker are problems", async () => {
    using dir = project(halfWritten);
    const format = ["-f", "json-with-metadata"];
    const { raw, exitCode } = await run(String(dir), [
      bunExe(),
      "lint",
      "--type-aware",
      "--type-check",
      ...format,
      "types.ts",
    ]);
    const results: { messages: { ruleId: string | null; line: number; column: number }[] }[] = JSON.parse(raw).results;
    const problems = results.flatMap(result => result.messages).map(it => `${it.line}:${it.column} ${it.ruleId}`);
    expect({ problems: problems.sort(), exitCode }).toEqual({
      problems: ["2:8 null", "2:9 typescript/TS1109", "3:1 typescript/TS1005"],
      exitCode: 1,
    });
  });
});
