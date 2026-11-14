// A diagnostic of the category `message`. TypeScript gives that category to the grammar error TS1450, and tsc fails on
// whatever it reports, of whatever category (`EmitFilesAndReportErrors`), and collects nothing more after it
// (`GetDiagnosticsOfAnyProgram`). Only its summary counts the errors alone.
//
// In a file of its own, with projects that load no library and one process of Bun at a time: twenty debug builds
// that start at once, as in check.test.ts, take most or all of the five seconds of a test.
import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { env, tsc } from "./differential";

type Files = Record<string, string>;

async function run(cwd: string, cmd: string[], more: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({ cmd, cwd, env: { ...env, ...more }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const clean = (text: string) =>
    text
      .replaceAll("\\", "/")
      .replaceAll(cwd.replaceAll("\\", "/"), "<dir>")
      .replace(/\[\d+(\.\d+)?m?s\]/g, "[time]")
      .trim();
  return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
}
const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);

// Instead of the library files, which a debug build takes seconds to read. `import()` is a `Promise`.
const globals =
  "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String Promise<T> PromiseConstructor ImportCallOptions"
    .split(" ")
    .map(name => `interface ${name} {}\n`)
    .join("") + `declare var Promise: PromiseConstructor;\ndeclare var console: { log(...args: unknown[]): void };\n`;
const options = {
  strict: true,
  noEmit: true,
  target: "esnext",
  module: "esnext",
  moduleResolution: "bundler",
  noLib: true,
  types: [],
  skipLibCheck: true,
};
const config = (more: object = {}, rest: object = {}) =>
  JSON.stringify({ compilerOptions: { ...options, ...more }, ...rest });
const project = (files: Files) =>
  tempDir("bun-check-message", { "tsconfig.json": config(), "globals.d.ts": globals, ...files });

const call = `export const p = import();\n`;
const text = "Dynamic imports can only accept a module specifier and an optional set of attributes as arguments";
const ts1450 = `TS1450: ${text}`;
const message = (file: string, column = 18, line = 1) => `${file}(${line},${column}): message ${ts1450}`;
const found = (checked: string) => `Found 1 message, checked ${checked} [time]`;

const withClass = `${call}export const C = class { private x = 1; };\n`;
const ts4094 =
  "index.ts(2,14): error TS4094: Property 'x' of exported anonymous class type may not be private or protected.";
const composite = { composite: true, noEmit: false, emitDeclarationOnly: true, outDir: "out" };

// What `bun check` prints for the files, with the arguments: the lines on standard output, then the summary.
const cases: Record<string, { args?: string[]; files: Files; stdout: string[]; summary: string; exitCode?: 0 }> = {
  "import()": { files: { "index.ts": call }, stdout: [message("index.ts")], summary: found("1 file") },
  "await import( )": {
    files: { "index.ts": `export const m = await import( );\n` },
    stdout: [message("index.ts", 24)],
    summary: found("1 file"),
  },
  "three arguments": {
    files: { "index.ts": `export const p = import("./m", {}, 1);\n`, "m.ts": `export const a = 1;\n` },
    stdout: [message("index.ts")],
    summary: found("2 files"),
  },
  "`module` is not set": {
    files: { "tsconfig.json": config({ module: undefined, moduleResolution: undefined }), "index.ts": call },
    stdout: [message("index.ts")],
    summary: found("1 file"),
  },
  "`module` is nodenext": {
    files: { "tsconfig.json": config({ module: "nodenext", moduleResolution: undefined }), "index.ts": call },
    stdout: [message("index.ts")],
    summary: found("1 file"),
  },
  "--quiet": { args: ["--quiet"], files: { "index.ts": call }, stdout: [], summary: found("1 file") },
  "two of them": {
    files: { "index.ts": `${call}export const q = import();\n` },
    stdout: [message("index.ts"), message("index.ts", 18, 2)],
    summary: "Found 2 messages, checked 1 file [time]",
  },
  // The summary counts what tsc counts in `Found 1 error.`
  "beside an error": {
    files: { "index.ts": `${call}export const n: number = "s";\n` },
    stdout: [message("index.ts"), "index.ts(2,14): error TS2322: Type 'string' is not assignable to type 'number'."],
    summary: "Found 1 error in 1 file, checked 1 file [time]",
  },
  "under `// @ts-ignore`": {
    files: { "index.ts": `// @ts-ignore\n${call}` },
    stdout: [],
    summary: "✓ No type errors in 1 file [time]",
    exitCode: 0,
  },
  "a JavaScript file": {
    files: { "tsconfig.json": config({ allowJs: true }), "index.js": call },
    stdout: [message("index.js")],
    summary: found("1 file"),
  },
  "a JavaScript file that is checked": {
    files: { "tsconfig.json": config({ allowJs: true, checkJs: true }), "index.js": call },
    stdout: [message("index.js")],
    summary: found("1 file"),
  },
  "a project of a build": {
    args: ["-b"],
    files: {
      "tsconfig.json": `{ "files": [], "references": [{ "path": "./lib" }, { "path": "./app" }] }`,
      "lib/tsconfig.json": config(composite),
      "lib/globals.d.ts": globals,
      "lib/a.ts": `${call}export const one = 1;\n`,
      "app/tsconfig.json": config(composite, { references: [{ path: "../lib" }] }),
      "app/globals.d.ts": globals,
      "app/b.ts": `import { one } from "../lib/a";\nexport const two: number = one;\n`,
    },
    stdout: [message("lib/a.ts")],
    summary: found("2 files across 2 projects"),
  },
  // `GetDiagnosticsOfAnyProgram` asks for the errors of the declaration files only where nothing else is reported.
  // Without `incremental` and `noEmitOnError`, `Emit` reports them after it.
  "`declaration` and `incremental`": {
    files: { "tsconfig.json": config({ declaration: true, incremental: true }), "index.ts": withClass },
    stdout: [message("index.ts")],
    summary: found("1 file"),
  },
  "`declaration` and `noEmitOnError`": {
    files: { "tsconfig.json": config({ declaration: true, noEmitOnError: true }), "index.ts": withClass },
    stdout: [message("index.ts")],
    summary: found("1 file"),
  },
  "`declaration`": {
    files: { "tsconfig.json": config({ declaration: true }), "index.ts": withClass },
    stdout: [message("index.ts"), ts4094],
    summary: "Found 1 error in 1 file, checked 1 file [time]",
  },
};

describe("bun check", () => {
  test.each(Object.entries(cases))("%s", async (_, { args = [], files, stdout, summary, exitCode = 1 }) => {
    using dir = project(files);
    const ours = await run(String(dir), [bunExe(), "check", ...args]);
    expect({ ...ours, stdout: lines(ours.stdout) }).toEqual({ stdout, stderr: summary, exitCode });
  });
});

// The layouts that tsc does not have. What a line is called there is Bun's own, and it is what says why the run failed.
describe("bun check, in its own layouts", () => {
  const layouts: Record<string, [args: string[], more: Record<string, string | undefined>, stdout: string[]]> = {
    "--pretty": [
      ["--pretty"],
      {},
      ["1 | export const p = import();", "                     ^", `note: ${ts1450}`, "   at index.ts:1:18"],
    ],
    "for an agent": [
      [],
      { AGENT: "1" },
      [
        `<message file="index.ts" line="1" column="18" code="TS1450">`,
        text,
        "<source>",
        "1 | export const p = import();",
        "                     ^^^^^^^^",
        "</source>",
        "</message>",
      ],
    ],
    "on GitHub Actions": [
      [],
      { GITHUB_ACTIONS: "true", GITHUB_WORKSPACE: undefined },
      [message("index.ts"), `::notice file=index.ts,line=1,col=18,endLine=1,endColumn=26,title=TS1450::${text}`],
    ],
  };
  test.each(Object.entries(layouts))("%s", async (_, [args, more, stdout]) => {
    using dir = project({ "index.ts": call });
    const ours = await run(String(dir), [bunExe(), "check", ...args], more);
    expect({ ...ours, stdout: lines(ours.stdout) }).toEqual({ stdout, stderr: found("1 file"), exitCode: 1 });
  });
});

// tsc is the oracle: the same lines, and it fails where `bun check` fails.
describe.skipIf(!tsc)("bun check and tsc", () => {
  test.each(Object.entries(cases))("%s", async (_, { args = [], files }) => {
    // Each has its own copy: a build writes files.
    using theirRoot = project(files);
    using ourRoot = project(files);
    const [theirs, ours] = [
      await run(String(theirRoot), [tsc!, ...args, "--pretty", "false"]),
      await run(String(ourRoot), [bunExe(), "check", ...args]),
    ];
    // tsc exits with 2 if it has written files in spite of what it reports.
    expect({ lines: lines(ours.stdout), fails: ours.exitCode !== 0 }).toEqual({
      lines: lines(theirs.stdout),
      fails: theirs.exitCode !== 0,
    });
  });
});

// half.ts is imported for its types alone, so only the type checker reads it: Bun's own parser refuses the call.
const halfWritten = {
  "half.ts": `export const p = import();\nexport type P = number;\n`,
  "main.ts": `import type { P } from "./half";\nconst p: P = 1;\nconsole.log("it ran", p);\n`,
};
const stopped = (checked: string) => ({
  stdout: "",
  stderr: [message("half.ts"), found(checked)],
  exitCode: 1,
});

describe("--check", () => {
  test("bun --check does not run the file", async () => {
    using dir = project(halfWritten);
    const ours = await run(String(dir), [bunExe(), "--check", "main.ts"]);
    expect({ ...ours, stderr: lines(ours.stderr) }).toEqual(stopped("2 files"));
  });

  test("bun run --check does not run the script", async () => {
    using dir = project({ ...halfWritten, "package.json": JSON.stringify({ scripts: { hello: "echo it ran" } }) });
    const ours = await run(String(dir), [bunExe(), "run", "--check", "hello"]);
    expect({ ...ours, stderr: lines(ours.stderr) }).toEqual(stopped("2 files"));
  });

  test("bun test --check does not run the tests", async () => {
    using dir = project({
      ...halfWritten,
      "bun-test.d.ts": `declare module "bun:test" {\n  export function test(name: string, fn: () => void): void;\n}\n`,
      "main.test.ts": `import { test } from "bun:test";\nimport type { P } from "./half";\nconst p: P = 1;\ntest("it ran", () => console.log(p));\n`,
    });
    const ours = await run(String(dir), [bunExe(), "test", "--check", "main.test.ts"]);
    // Its first line has the version.
    const stdout = ours.stdout.replace(/^bun test v\S+ \(\w+\)$/, "bun test");
    expect({ ...ours, stdout, stderr: lines(ours.stderr) }).toEqual({ ...stopped("2 files"), stdout: "bun test" });
  });

  const logged = `1 | export const p = import();
                     ^
error: ${ts1450}
    at <dir>/half.ts:1:18`;

  test("bun build --check writes nothing", async () => {
    using dir = project(halfWritten);
    const ours = await run(String(dir), [bunExe(), "build", "--check", "main.ts", "--outdir", "out"]);
    expect(ours).toEqual({ stdout: "", stderr: logged, exitCode: 1 });
    expect(await Bun.file(join(String(dir), "out", "main.js")).exists()).toBe(false);
  });

  test("bun build --no-bundle --check prints nothing", async () => {
    using dir = project(halfWritten);
    const ours = await run(String(dir), [bunExe(), "build", "--no-bundle", "--check", "main.ts"]);
    expect(ours).toEqual({ stdout: "", stderr: logged, exitCode: 1 });
  });

  test("Bun.build({ check: true }) has it among its errors", async () => {
    using dir = project({
      ...halfWritten,
      "build.mjs": `
        const result = await Bun.build({ entrypoints: ["main.ts"], outdir: "out", check: true, throw: false });
        const logs = result.logs.map(log => [log.level, log.message, log.position?.line, log.position?.column]);
        console.log(JSON.stringify({ success: result.success, outputs: result.outputs.length, logs }));
      `,
    });
    const ours = await run(String(dir), [bunExe(), "build.mjs"]);
    expect(JSON.parse(ours.stdout)).toEqual({ success: false, outputs: 0, logs: [["error", ts1450, 1, 18]] });
    expect(await Bun.file(join(String(dir), "out", "main.js")).exists()).toBe(false);
    expect(ours.exitCode).toBe(0);
  });
});

// oxlint makes a problem of it, like of every other diagnostic of the type checker.
describe("bun lint --type-aware --type-check", () => {
  const problems = async (files: Files) => {
    using dir = project({ "a.ts": call, ...files });
    const format = ["-f", "json-with-metadata"];
    const ours = await run(String(dir), [bunExe(), "lint", "--type-aware", "--type-check", ...format, "a.ts"]);
    const results: { messages: { ruleId: string | null; line: number; column: number }[] }[] = JSON.parse(
      ours.stdout,
    ).results;
    const messages = results.flatMap(result => result.messages);
    return { problems: messages.map(it => `${it.line}:${it.column} ${it.ruleId}`).sort(), exitCode: ours.exitCode };
  };

  // oxlint 1.88 has a second problem at the same place: its parser refuses the call as well.
  test("beside an .oxlintrc.json", async () => {
    expect(await problems({ ".oxlintrc.json": "{}" })).toEqual({
      problems: expect.arrayContaining(["1:18 typescript/TS1450"]),
      exitCode: 1,
    });
  });

  // The parser of the linter refuses the call as well.
  test("without a configuration file", async () => {
    expect(await problems({})).toEqual({ problems: ["1:17 null", "1:18 typescript/TS1450"], exitCode: 1 });
  });
});
