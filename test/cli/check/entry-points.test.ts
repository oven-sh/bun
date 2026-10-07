// What `--check` checks does not depend on the kind of project that the entry point is in, on how Bun gets to the entry
// point, or on the command: every kind of project, with every kind of entry point, with and without a type error.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
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
// `paths`: an option that the defaults lack, so that it shows whose options a file is checked with.
const config = (more: object = {}, others: object = {}) =>
  JSON.stringify({ compilerOptions: { ...options, paths: { "@/*": ["./*"] }, ...more }, ...others });

// `app`: where the entry point is, and where `bun` is started. `tsconfig`: `--tsconfig-override`. `isSolution`: the
// nearest tsconfig.json has no files and no options of its own, so what `include` of the projects that it references does
// not find is checked with the defaults.
type Kind = { name: string; app: string; tsconfig?: string; isSolution?: boolean; files: Record<string, string> };
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
  {
    // As `bun create vite` lays it out.
    name: "beside a solution",
    app: ".",
    isSolution: true,
    files: {
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      "tsconfig.app.json": config({ noEmit: true }),
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
const server = (seen: string) =>
  `/// <reference path="./html.d.ts" />\n${seen}import page from "./index.html";\n${run}export { page };\n`;

type Command = "bun --check" | "bun check" | "bun build --check" | "bun build --no-bundle --check" | "Bun.build";
const everyCommand: Command[] = [
  "bun --check",
  "bun check",
  "bun build --check",
  "bun build --no-bundle --check",
  "Bun.build",
];
// `bun check` has no `--loader`.
const withLoader = everyCommand.filter(command => command !== "bun check");

// `wrong`: the file with the type error. `seen`: only resolves with `paths`, and is not there when the program runs.
// `isIncluded`: `include` finds the entry point, by its name or by `--loader`.
type Entry = {
  name: string;
  wrong: string;
  isIncluded: boolean;
  loader?: [extension: string, loader: string];
  target?: "bun";
  commands: Command[];
  main: (isCorrect: boolean, seen: string) => string[];
  stdin?: (isCorrect: boolean, seen: string) => string;
  files: (isCorrect: boolean, seen: string) => Record<string, string>;
};
const entries: Entry[] = [
  {
    name: "a TypeScript file",
    wrong: "imported.ts",
    isIncluded: true,
    commands: everyCommand,
    main: () => ["main.ts"],
    files: (isCorrect, seen) => ({
      "main.ts": `${seen}import { n } from "./imported";\nexport const m: number = n;\n${run}`,
      "imported.ts": `export const n: number = ${value(isCorrect)};\n`,
    }),
  },
  {
    name: "a file without an extension",
    wrong: "cli",
    isIncluded: false,
    commands: ["bun --check"],
    main: () => ["cli"],
    files: (isCorrect, seen) => ({
      "cli": `#!/usr/bin/env bun\n${seen}export const n: number = ${value(isCorrect)};\n${run}`,
    }),
  },
  {
    name: "-e",
    wrong: "[eval]",
    isIncluded: false,
    commands: ["bun --check"],
    main: (isCorrect, seen) => ["-e", `${seen}export const n: number = ${value(isCorrect)};\n${run}`],
    files: () => ({}),
  },
  {
    name: "stdin",
    wrong: "[stdin]",
    isIncluded: false,
    commands: ["bun --check"],
    main: () => ["-"],
    stdin: (isCorrect, seen) => `${seen}export const n: number = ${value(isCorrect)};\n${run}`,
    files: () => ({}),
  },
  {
    name: "--loader for an extension that says nothing",
    wrong: "imported.script",
    isIncluded: true,
    loader: [".script", "ts"],
    commands: withLoader,
    main: () => ["main.script"],
    files: (isCorrect, seen) => ({
      "main.script": `${seen}import { n } from "./imported.script";\nexport const m: number = n;\n${run}`,
      "imported.script": `export const n: number = ${value(isCorrect)};\n`,
    }),
  },
  {
    name: "--loader for an extension that says something else",
    wrong: "imported.js",
    isIncluded: true,
    loader: [".js", "ts"],
    commands: withLoader,
    main: () => ["main.js"],
    files: (isCorrect, seen) => ({
      "main.js": `${seen}import { n } from "./imported.js";\nexport const m: number = n;\n${run}`,
      "imported.js": `export const n: number = ${value(isCorrect)};\n`,
    }),
  },
  // What is only imported for its types is not in a bundle.
  ...[".script", ".js"].map(
    (extension): Entry => ({
      name: `--loader ${extension}:ts, a file that is only imported for its types`,
      wrong: `types${extension}`,
      isIncluded: true,
      loader: [extension, "ts"],
      commands: withLoader,
      main: () => [`main${extension}`],
      files: (isCorrect, seen) => ({
        [`main${extension}`]: `${seen}import type { N } from "./types${extension}";\nexport const m: N = 1;\n${run}`,
        [`types${extension}`]: `export type N = number;\nexport const n: N = ${value(isCorrect)};\n`,
      }),
    }),
  ),
  {
    // Without `allowJs`.
    name: "a JavaScript file with its declaration file",
    wrong: "main.ts",
    isIncluded: true,
    commands: everyCommand,
    main: () => ["main.ts"],
    files: (isCorrect, seen) => ({
      "main.ts": `${seen}import { f } from "./legacy.js";\nexport const n: number = f();\n${run}`,
      "legacy.js": `export function f() {\n  return 1;\n}\n`,
      "legacy.d.ts": `export declare function f(): ${isCorrect ? "number" : "string"};\n`,
    }),
  },
  {
    name: "a page with a TypeScript file",
    wrong: "client.ts",
    isIncluded: true,
    target: "bun",
    commands: everyCommand,
    main: () => ["server.ts"],
    files: (isCorrect, seen) => ({
      "html.d.ts": html,
      "index.html": page("./client.ts"),
      "client.ts": `${seen}export const n: number = ${value(isCorrect)};\n`,
      "server.ts": server(seen),
    }),
  },
  {
    // Without `allowJs`.
    name: "a page with a JavaScript file",
    wrong: "typed.ts",
    isIncluded: true,
    target: "bun",
    commands: everyCommand,
    main: () => ["server.ts"],
    files: (isCorrect, seen) => ({
      "html.d.ts": html,
      "index.html": page("./client.js"),
      "client.js": `import "./typed";\n`,
      "typed.ts": `${seen}export const n: number = ${value(isCorrect)};\n`,
      "server.ts": server(seen),
    }),
  },
];

function argumentsOf(command: Command, kind: Kind, entry: Entry, main: string[]) {
  const tsconfig = kind.tsconfig ? ["--tsconfig-override", kind.tsconfig] : [];
  const loader = entry.loader ? ["--loader", entry.loader.join(":")] : [];
  const target = entry.target ? [`--target=${entry.target}`] : [];
  switch (command) {
    case "bun --check":
      return [...tsconfig, "--check", ...loader, ...main];
    case "bun check":
      return ["check", ...(kind.tsconfig ? ["--project", kind.tsconfig] : []), ...main];
    case "bun build --check":
      return ["build", ...tsconfig, "--check", ...loader, ...target, ...main, "--outdir", "out"];
    case "bun build --no-bundle --check":
      return ["build", ...tsconfig, "--no-bundle", "--check", ...loader, ...target, ...main];
    case "Bun.build": {
      const build = {
        entrypoints: main,
        outdir: "out",
        check: true,
        throw: false,
        target: entry.target,
        loader: entry.loader && Object.fromEntries([entry.loader]),
        tsconfig: kind.tsconfig,
      };
      return [
        "-e",
        `const { success, logs } = await Bun.build(${JSON.stringify(build)});
        for (const log of logs) console.error(log.position?.file, log.message);
        process.exit(success ? 0 : 1);`,
      ];
    }
  }
}

// Each takes a process. A debug build runs a sample of them.
const every = isDebug || isASAN ? 3 : 1;
const cases = kinds
  .flatMap(kind =>
    entries.flatMap(entry =>
      entry.commands.flatMap(command =>
        [true, false].map(isCorrect => {
          const name = `${kind.name}: ${entry.name}: ${command}, ${isCorrect ? "no error" : "an error"}`;
          return [name, kind, entry, command, isCorrect] as const;
        }),
      ),
    ),
  )
  .filter((_, index) => index % every === 0);

test.concurrent.each(cases)("%s", async (_, kind, entry, command, isCorrect) => {
  const hasPaths = Object.keys(kind.files).length > 0 && (entry.isIncluded || !kind.isSolution);
  const seen = hasPaths ? `import type { Seen } from "@/seen";\nexport type Used = Seen;\n` : "";
  const inApp = Object.entries(entry.files(isCorrect, seen)).map(([name, text]) => [join(kind.app, name), text]);
  using dir = tempDir("bun-check", {
    ...kind.files,
    ...Object.fromEntries(inApp),
    [join(kind.app, "seen.ts")]: `export type Seen = number;\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...argumentsOf(command, kind, entry, entry.main(isCorrect, seen))],
    cwd: join(String(dir), kind.app),
    env,
    stdin: entry.stdin ? new Blob([entry.stdin(isCorrect, seen)]) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // `--no-bundle` prints the program.
  const printed = command === "bun build --no-bundle --check" ? stderr : stdout + stderr;
  expect({
    codes: [...new Set(printed.match(/\bTS\d+/g))],
    namesTheFile: printed.includes(entry.wrong),
    ran: command === "bun --check" && stdout.includes("it ran"),
    exitCode,
  }).toEqual({
    codes: isCorrect ? [] : ["TS2322"],
    namesTheFile: !isCorrect,
    ran: isCorrect && command === "bun --check",
    exitCode: isCorrect ? 0 : 1,
  });
});

test("a byte order mark is not a column, wherever the text comes from", async () => {
  const text = `export const n: number = "1";\n`;
  using dir = tempDir("bun-check", {
    "tsconfig.json": config({ noEmit: true }),
    "index.ts": "\uFEFF" + text,
    "build.ts": `
      const text = ${JSON.stringify(text)};
      const path = require("node:path").join(import.meta.dir, "memory.ts");
      const inMemory = value => ({ entrypoints: [path], files: { [path]: value } });
      for (const options of [
        { entrypoints: ["index.ts"] },
        inMemory("\\uFEFF" + text),
        inMemory(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)])),
      ]) {
        const { logs } = await Bun.build({ check: true, throw: false, ...options });
        const places = logs.map(({ position, message }) =>
          position ? [position.line, position.column, position.lineText] : message,
        );
        console.log(JSON.stringify(places));
      }
    `,
  });
  const run = async (cmd: string[], stdin?: string) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      cwd: String(dir),
      env,
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return stdout + stderr;
  };
  const place = (printed: string) => /[(:]1[,:](\d+)/.exec(printed)?.[1];
  const printed = await Promise.all([
    run(["check"]),
    run(["--check", "index.ts"]),
    run(["--check", "-"], "\uFEFF" + text),
    run(["build", "--check", "index.ts", "--outdir", "out"]),
  ]);
  expect(printed.map(place)).toEqual(["14", "14", "14", "14"]);
  expect(printed.filter(it => it.includes("\uFEFF"))).toEqual([]);
  const line = JSON.stringify([[1, 14, text.trimEnd()]]);
  expect((await run(["build.ts"])).trim().split("\n")).toEqual([line, line, line]);
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
