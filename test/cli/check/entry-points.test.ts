// What `--check` checks does not depend on the kind of project that the entry point is in, on how Bun gets to the entry
// point, or on the command: every kind of project, with every kind of entry point, with and without a type error.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  NO_COLOR: "1",
};

const options = { strict: true, types: [], lib: ["esnext"], module: "preserve", moduleResolution: "bundler" };
const config = (more: object = {}, others: object = {}) =>
  JSON.stringify({ compilerOptions: { ...options, ...more }, ...others });

// `app`: where the entry point is, and where `bun` is started. `tsconfig`: `--tsconfig-override`.
type Kind = { name: string; app: string; tsconfig?: string; files: Record<string, string> };
const kinds: Kind[] = [
  { name: "a tsconfig.json", app: ".", files: { "tsconfig.json": config({ noEmit: true }) } },
  {
    name: "references",
    app: "app",
    files: {
      "shared/tsconfig.json": config({ composite: true, outDir: "dist" }, { include: ["*.ts"] }),
      "shared/shared.ts": `export const shared: number = 1;\n`,
      "app/tsconfig.json": config({ noEmit: true }, { references: [{ path: "../shared" }] }),
      "app/own.ts": `export const own: number = 1;\n`,
    },
  },
  {
    name: "under a solution",
    app: "app",
    files: {
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./app" }] }),
      "app/tsconfig.json": config({ composite: true, outDir: "dist" }),
    },
  },
  { name: "no tsconfig.json", app: ".", files: {} },
  {
    name: "--tsconfig-override",
    app: ".",
    tsconfig: "other.json",
    files: { "other.json": config({ noEmit: true }), "tsconfig.json": `{ "compilerOptions": { "strict": "no" } }` },
  },
];

// In a module, so it is not the one of a library. The text that is printed is not in the source.
const run = `declare var console: { log(...args: unknown[]): void };\nconsole.log("it " + "ran");\n`;
const value = (isCorrect: boolean) => (isCorrect ? "1" : `"1"`);
const html = `declare module "*.html" {\n  const page: unknown;\n  export default page;\n}\n`;
const page = (src: string) => `<!doctype html><script type="module" src="${src}"></script>\n`;
const server = `/// <reference path="./html.d.ts" />\nimport page from "./index.html";\n${run}export { page };\n`;
const serving = [
  ["--check", "server.ts"],
  ["check", "server.ts"],
  ["build", "--check", "--target=bun", "server.ts"],
];

// `wrong`: the file with the type error. `commands`: the first word is the command, or a flag of `bun`.
type Entry = {
  name: string;
  wrong: string;
  stdin?: (isCorrect: boolean) => string;
  files: (isCorrect: boolean) => Record<string, string>;
  commands: (isCorrect: boolean) => string[][];
};
const entries: Entry[] = [
  {
    name: "a file without an extension",
    wrong: "cli",
    files: isCorrect => ({ "cli": `#!/usr/bin/env bun\nexport const n: number = ${value(isCorrect)};\n${run}` }),
    commands: () => [["--check", "cli"]],
  },
  {
    name: "-e",
    wrong: "[eval]",
    files: () => ({}),
    commands: isCorrect => [["--check", "-e", `export const n: number = ${value(isCorrect)};\n${run}`]],
  },
  {
    name: "stdin",
    wrong: "[stdin]",
    stdin: isCorrect => `export const n: number = ${value(isCorrect)};\n${run}`,
    files: () => ({}),
    commands: () => [["--check", "-"]],
  },
  {
    name: "--loader for an extension that says nothing",
    wrong: "imported.script",
    files: isCorrect => ({
      "main.script": `import { n } from "./imported.script";\nexport const m: number = n;\n${run}`,
      "imported.script": `export const n: number = ${value(isCorrect)};\n`,
    }),
    commands: () => [
      ["--check", "--loader", ".script:ts", "main.script"],
      ["build", "--check", "--loader", ".script:ts", "main.script"],
    ],
  },
  {
    name: "--loader for an extension that says something else",
    wrong: "imported.js",
    files: isCorrect => ({
      "main.js": `import { n } from "./imported.js";\nexport const m: number = n;\n${run}`,
      "imported.js": `export const n: number = ${value(isCorrect)};\n`,
    }),
    commands: () => [
      ["--check", "--loader", ".js:ts", "main.js"],
      ["build", "--check", "--loader", ".js:ts", "main.js"],
    ],
  },
  {
    name: "a page with a TypeScript file",
    wrong: "client.ts",
    files: isCorrect => ({
      "html.d.ts": html,
      "index.html": page("./client.ts"),
      "client.ts": `export const n: number = ${value(isCorrect)};\n`,
      "server.ts": server,
    }),
    commands: () => serving,
  },
  {
    // Without `allowJs`.
    name: "a page with a JavaScript file",
    wrong: "typed.ts",
    files: isCorrect => ({
      "html.d.ts": html,
      "index.html": page("./client.js"),
      "client.js": `import "./typed";\n`,
      "typed.ts": `export const n: number = ${value(isCorrect)};\n`,
      "server.ts": server,
    }),
    commands: () => serving,
  },
];

const cases = kinds.flatMap(kind => entries.map(entry => [`${kind.name}: ${entry.name}`, kind, entry] as const));

test.concurrent.each(cases)("%s", async (_, kind, entry) => {
  for (const isCorrect of [true, false]) {
    const inApp = Object.entries(entry.files(isCorrect)).map(([name, text]) => [join(kind.app, name), text]);
    // So that there is an `app`.
    using dir = tempDir("bun-check", {
      ...kind.files,
      ...Object.fromEntries(inApp),
      [join(kind.app, "empty.txt")]: "",
    });
    const results = entry.commands(isCorrect).map(async ([first, ...rest]) => {
      const tsconfig = kind.tsconfig ? [first === "check" ? "--project" : "--tsconfig-override", kind.tsconfig] : [];
      const cmd =
        first === "check"
          ? ["check", ...tsconfig, ...rest]
          : first === "build"
            ? ["build", ...tsconfig, ...rest, "--outdir", "out"]
            : [...tsconfig, first, ...rest];
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...cmd],
        cwd: join(String(dir), kind.app),
        env,
        stdin: entry.stdin ? new Blob([entry.stdin(isCorrect)]) : "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const printed = stdout + stderr;
      return {
        cmd: cmd.join(" "),
        codes: [...new Set(printed.match(/\bTS\d+/g))],
        namesTheFile: printed.includes(entry.wrong),
        ran: stdout.includes("it ran"),
        exitCode,
      };
    });
    expect(await Promise.all(results)).toEqual(
      (await Promise.all(results)).map(({ cmd }) => ({
        cmd,
        codes: isCorrect ? [] : ["TS2322"],
        namesTheFile: !isCorrect,
        ran: isCorrect && !/^(check|build) /.test(cmd),
        exitCode: isCorrect ? 0 : 1,
      })),
    );
  }
});

test("Bun.build: the check has the conditions and the loaders of the build, not those of the process", async () => {
  const exports = (conditions: object) =>
    JSON.stringify({ name: "it", version: "1.0.0", exports: { ".": conditions } });
  using dir = tempDir("bun-check", {
    "tsconfig.json": config({ noEmit: true }, { include: ["none.ts"] }),
    "none.ts": "",
    "node_modules/both/package.json": exports({ mine: "./mine.ts", default: "./default.ts" }),
    "node_modules/both/mine.ts": `export const n: number = "1";\n`,
    "node_modules/both/default.ts": `export const n: number = 1;\n`,
    "node_modules/one/package.json": exports({ mine: "./mine.ts" }),
    "node_modules/one/mine.ts": `export const n: number = 1;\n`,
    "both.ts": `export { n } from "both";\n`,
    "one.ts": `export { n } from "one";\n`,
    "main.script": `export { n } from "./imported.script";\n`,
    "imported.script": `export const n: number = "1";\n`,
    "build.ts": `
      const results = [];
      for (const options of [
        { entrypoints: ["both.ts"] },
        { entrypoints: ["both.ts"], conditions: ["mine"] },
        { entrypoints: ["one.ts"], conditions: ["mine"] },
        { entrypoints: ["main.script"], loader: { ".script": "ts" } },
      ]) {
        const { success, logs } = await Bun.build({ outdir: "out", throw: false, check: true, ...options });
        results.push([success, logs.map(log => log.position.file.replaceAll("\\\\", "/").split("/").pop() + " " + log.message.slice(0, 6))]);
      }
      console.log(JSON.stringify(results));
    `,
  });
  const expected = [
    [true, []],
    [false, ["mine.ts TS2322"]],
    [true, []],
    [false, ["imported.script TS2322"]],
  ];
  for (const flags of [[], ["--conditions=mine"]]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "build.ts"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect([flags, stderr, JSON.parse(stdout), exitCode]).toEqual([flags, "", expected, 0]);
  }
});
