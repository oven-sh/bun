// The project that a named file is checked in. A project reads the sources of a project that it references through
// their declaration files, so a file that both list is checked in the referenced one: there `tsc -b` reports it, and
// that is the project an editor shows it in.
//
// In a file of its own, with projects that load no library and one process for a test: check.test.ts and
// entry-points.test.ts start twenty debug builds at a time, which do not end within the five seconds of a test.
import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { env, tsc } from "./differential";

async function run(cwd: string, cmd: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const clean = (text: string) => text.replaceAll("\\", "/").trim();
  return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
}

type Files = Record<string, string>;

/** A test for each of `commandLines`: in `files`, `bun check` with it prints `errors`. */
function checks(name: string, files: Files, errors: string[], commandLines: string[][]) {
  const cases = commandLines.map(args => [args.join(" ") || "no argument", args] as const);
  test.each(cases)(`${name}: %s`, async (_, args) => {
    using dir = tempDir("bun-check-project-of-file", files);
    const { stdout, exitCode } = await run(String(dir), ["check", ...args]);
    expect({ errors: stdout.split("\n").filter(Boolean), exitCode }).toEqual({
      errors,
      exitCode: errors.length ? 1 : 0,
    });
  });
}

// Instead of the library files, which a debug build takes seconds to read.
const globals = "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String"
  .split(" ")
  .map(name => `interface ${name} {}\n`)
  .join("");
const strict = { strict: true, noLib: true, types: [] };
const loose = { ...strict, strict: false };
const emitted = { composite: true, emitDeclarationOnly: true };
const config = (compilerOptions: object, more: object = {}) => JSON.stringify({ compilerOptions, ...more });
const references = (...paths: string[]) => ({ references: paths.map(path => ({ path })) });
const circular = (path: string) => ({ references: [{ path, circular: true }] });

const wrong = `export const wrong: number = "";\n`;
// An error only where `strict` is on: it shows whose options a file is checked with.
const implicit = `export function f(x) {\n  return x;\n}\n`;
const assignment = (file: string, line = 1) =>
  `${file}(${line},14): error TS2322: Type 'string' is not assignable to type 'number'.`;
const parameter = (file: string) => `${file}(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type.`;

describe("a file that the nearest tsconfig.json and a project that it references both list", () => {
  // The tsconfig.json includes everything. Its options are the loose ones.
  const beside = {
    "tsconfig.json": config({ ...loose, noEmit: true }, references("./tsconfig.node.json")),
    "tsconfig.node.json": config(
      { ...strict, ...emitted, outDir: "out" },
      { include: ["vite.config.ts", "globals.d.ts"] },
    ),
    "globals.d.ts": globals,
    "vite.config.ts": implicit + wrong,
    "src/a.ts": `export const ok = 1;\n`,
  };
  const ofTheReferenced = [parameter("vite.config.ts"), assignment("vite.config.ts", 4)];
  checks("is checked with the options of the referenced project", beside, ofTheReferenced, [
    ["vite.config.ts"],
    ["src/a.ts", "vite.config.ts"],
    ["vite.config.ts", "src/a.ts"],
    ["-p", ".", "vite.config.ts"],
    ["src", "vite.config.ts"],
    [".", "vite.config.ts"],
  ]);
  checks("is reported by its directory, a build and the referenced project", beside, ofTheReferenced, [
    ["."],
    ["-b"],
    ["-p", "tsconfig.node.json"],
  ]);
  // It reads the declaration file, like `tsc`.
  checks("is not reported by the nearest project", beside, [], [[], ["src/a.ts"]]);
  // An option of the command line is for every project that a directory reports.
  checks(
    "is checked with the command line beside its directory",
    beside,
    [assignment("vite.config.ts", 4)],
    [["--strict", "false", ".", "vite.config.ts"]],
  );

  // tsconfig.json has the tests too, and the configuration file of the build, which is the loose one, leaves them out.
  const forTheBuild = {
    "tsconfig.json": config(
      { ...strict, noEmit: true },
      { include: ["src", "test"], ...references("./tsconfig.build.json") },
    ),
    "tsconfig.build.json": config({ ...loose, ...emitted, outDir: "dist" }, { include: ["src"] }),
    "src/globals.d.ts": globals,
    "src/a.ts": implicit + wrong,
    "src/ok.ts": `export const ok = 1;\n`,
    "test/a.test.ts": `import { ok } from "../src/ok";\nexport const t: string = ok;\n`,
  };
  const inTheTest = `test/a.test.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.`;
  checks(
    "is checked where the build has it",
    forTheBuild,
    [assignment("src/a.ts", 4)],
    [["src/a.ts"], ["src/a.ts", "src/ok.ts"], ["src"]],
  );
  checks(
    "is reported once beside a file of the nearest project",
    forTheBuild,
    [assignment("src/a.ts", 4), inTheTest],
    [["src/a.ts", "test/a.test.ts"], ["test/a.test.ts", "src/a.ts"], ["test", "src/a.ts"], ["-b"]],
  );
  checks(
    "is not reported with the files of the nearest project",
    forTheBuild,
    [inTheTest],
    [[], ["test/a.test.ts"], ["test"]],
  );
  checks(
    "is reported alone, whatever else the referenced project has",
    { ...forTheBuild, "src/broken.ts": `export const = ;\n` },
    [assignment("src/a.ts", 4)],
    [["src/a.ts"]],
  );
  // A directory stands for the referenced project, which another reads, as a whole.
  checks(
    "is reported with the other files of the referenced project by a directory in it",
    { ...forTheBuild, "src/sub/x.ts": wrong },
    [assignment("src/a.ts", 4), assignment("src/sub/x.ts")],
    [["src/sub"]],
  );

  // `a` references `b`, which is the loose one.
  const nested = {
    "tsconfig.a.json": config(
      { ...strict, ...emitted, outDir: "out-a" },
      { include: ["src"], ...references("./tsconfig.b.json") },
    ),
    "tsconfig.b.json": config({ ...loose, ...emitted, outDir: "out-b" }, { include: ["src"] }),
    "src/globals.d.ts": globals,
    "src/f.ts": implicit + wrong,
  };
  const innermost = [["src/f.ts"], ["-p", "tsconfig.a.json", "src/f.ts"]];
  checks(
    "is checked in the innermost project, under a tsconfig.json with nothing but references",
    { ...nested, "tsconfig.json": JSON.stringify({ files: [], ...references("./tsconfig.a.json") }) },
    [assignment("src/f.ts", 4)],
    innermost,
  );
  checks(
    "is checked in the innermost project, under a tsconfig.json that lists it too",
    { ...nested, "tsconfig.json": config({ ...strict, noEmit: true }, references("./tsconfig.a.json")) },
    [assignment("src/f.ts", 4)],
    innermost,
  );

  const below = "packages/a/src/f.ts";
  checks(
    "is checked in a directory that is named, where the tsconfig.json files are below it",
    {
      "packages/a/tsconfig.json": config(
        { ...loose, noEmit: true },
        { include: ["src"], ...references("./tsconfig.build.json") },
      ),
      "packages/a/tsconfig.build.json": config({ ...strict, ...emitted, outDir: "out" }, { include: ["src"] }),
      "packages/a/src/globals.d.ts": globals,
      [below]: implicit + wrong,
    },
    [parameter(below), assignment(below, 4)],
    [["."], ["packages"], ["packages/a"], [below]],
  );

  checks(
    "stays in the nearest project if it is a declaration file, which both read",
    {
      "tsconfig.json": config(
        { ...strict, noEmit: true },
        { include: ["src"], ...references("./tsconfig.build.json") },
      ),
      "tsconfig.build.json": config({ ...loose, ...emitted, outDir: "out" }, { include: ["src"] }),
      "src/globals.d.ts": globals,
      "src/api.d.ts": `declare function f(x);\n`,
    },
    [
      `src/api.d.ts(1,18): error TS7010: 'f', which lacks return-type annotation, implicitly has an 'any' return type.`,
      `src/api.d.ts(1,20): error TS7006: Parameter 'x' implicitly has an 'any' type.`,
    ],
    [["src/api.d.ts"], [], ["."]],
  );
});

// What is not named is reported as before: as tsc reports it, which reads such a file through its declaration file.
describe.skipIf(!tsc)("without a file name, a project that shares a file with one that it references", () => {
  const layouts: Record<string, Files> = {
    "lists everything": {
      "tsconfig.json": config({ ...strict, noEmit: true }, references("./tsconfig.node.json")),
      "tsconfig.node.json": config(
        { ...strict, ...emitted, outDir: "out" },
        { include: ["vite.config.ts", "globals.d.ts"] },
      ),
      "globals.d.ts": globals,
      "vite.config.ts": wrong,
      "src/a.ts": wrong,
    },
    "is in a cycle of references": {
      "tsconfig.json": config(
        { ...strict, ...emitted, outDir: "out-a" },
        { include: ["a.ts", "globals.d.ts"], ...circular("./tsconfig.other.json") },
      ),
      "tsconfig.other.json": config(
        { ...strict, ...emitted, outDir: "out-b" },
        { include: ["*.ts"], ...circular("./tsconfig.json") },
      ),
      "globals.d.ts": globals,
      "a.ts": wrong,
      "b.ts": wrong,
    },
    "references one that is not there too": {
      "tsconfig.json": config(
        { ...strict, noEmit: true },
        { include: ["src", "globals.d.ts"], ...references("./gone", "./tsconfig.build.json") },
      ),
      "tsconfig.build.json": config(
        { ...strict, ...emitted, outDir: "dist" },
        { include: ["src/a.ts", "globals.d.ts"] },
      ),
      "globals.d.ts": globals,
      "src/a.ts": wrong,
      "src/main.ts": wrong,
    },
  };
  const cells = Object.keys(layouts).flatMap(layout =>
    [[], ["-p", "."], ["--noEmit"], ["-b"]].map(args => [layout, args.join(" ") || "no argument", args] as const),
  );
  test.each(cells)("%s: %s", async (layout, _, args) => {
    // Each has its own copy: a build writes files.
    const files = layouts[layout];
    const copies = Object.entries(files).flatMap(([path, text]) =>
      ["theirs", "ours"].map(side => [`${side}/${path}`, text]),
    );
    using dir = tempDir("bun-check-project-of-file", Object.fromEntries(copies));
    const outcomeOf = async (cmd: string[], side: string) => {
      const cwd = join(String(dir), side);
      await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const lines = stdout.replaceAll("\\", "/").replaceAll(cwd.replaceAll("\\", "/"), "").split(/\r?\n/);
      // tsc exits with 2 if it has written files in spite of errors.
      return { lines: lines.filter(line => line.trim()), fails: exitCode !== 0 };
    };
    const theirs = await outcomeOf([tsc!, ...args, "--pretty", "false"], "theirs");
    expect(await outcomeOf([bunExe(), "check", ...args], "ours")).toEqual(theirs);
  });
});

describe("of the projects that a tsconfig.json references, the nearest that lists the file checks it", () => {
  // `a` references `c`, and `b` and `c` list the file. `c` is the loose one.
  const files = {
    "tsconfig.a.json": config(
      { ...strict, ...emitted, outDir: "out-a" },
      { files: ["globals.d.ts", "other.ts"], ...references("./tsconfig.c.json") },
    ),
    "tsconfig.b.json": config({ ...strict, ...emitted, outDir: "out-b" }, { files: ["globals.d.ts", "f.ts"] }),
    "tsconfig.c.json": config({ ...loose, ...emitted, outDir: "out-c" }, { files: ["globals.d.ts", "f.ts"] }),
    "globals.d.ts": globals,
    "other.ts": `export const other = 1;\n`,
    "f.ts": implicit,
  };
  const both = references("./tsconfig.a.json", "./tsconfig.b.json");
  checks(
    "under a tsconfig.json with nothing but references",
    { ...files, "tsconfig.json": JSON.stringify({ files: [], ...both }) },
    [parameter("f.ts")],
    [["f.ts"]],
  );
  checks(
    "under a tsconfig.json that lists it too",
    {
      ...files,
      "tsconfig.json": config({ ...loose, noEmit: true }, { files: ["globals.d.ts", "f.ts", "other.ts"], ...both }),
    },
    [parameter("f.ts")],
    [["f.ts"]],
  );
});

describe("a file that is named", () => {
  test.each([
    ["g.ts", "sub/f.ts"],
    ["sub/f.ts", "g.ts"],
  ])("is checked once, in its own project, if another project that is checked lists it too: %s %s", async (...args) => {
    using dir = tempDir("bun-check-project-of-file", {
      "tsconfig.json": config(
        { ...strict, noEmit: true },
        { include: ["g.ts", "globals.d.ts", "sub"], ...references("./lib") },
      ),
      "lib/tsconfig.json": config({ ...strict, ...emitted, outDir: "out" }, { include: ["*.ts", "../globals.d.ts"] }),
      "lib/x.ts": `export const x = 1;\n`,
      "sub/tsconfig.json": config({ ...loose, noEmit: true }, { include: ["*.ts", "../globals.d.ts"] }),
      "sub/f.ts": implicit,
      "globals.d.ts": globals,
      "g.ts": `import { f } from "./sub/f";\nexport const g = f;\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["check", ...args]);
    expect([stdout, stderr.replace(/ \[.*\]$/, ""), exitCode]).toEqual([
      "",
      "✓ No type errors in 2 files across 2 projects",
      0,
    ]);
  });

  // Under `--outDir gen` no project lists what is in `gen`: the file is of the nearest one, which is the strict one.
  // The project that is only read still lists the file.
  const generated = {
    "tsconfig.json": config({ ...strict, noEmit: true }, references("./tsconfig.node.json")),
    "tsconfig.node.json": config({ ...loose, ...emitted, outDir: "out" }, { include: ["gen", "globals.d.ts"] }),
    "globals.d.ts": globals,
    "gen/f.ts": implicit + wrong,
    "src/a.ts": `export const ok = 1;\n`,
  };
  checks("is of the referenced project that lists it", generated, [assignment("gen/f.ts", 4)], [["gen/f.ts"]]);
  checks(
    "is read from its source where an option of the command line changes what the projects list",
    generated,
    [parameter("gen/f.ts"), assignment("gen/f.ts", 4)],
    [["--outDir", "gen", "gen/f.ts"]],
  );

  checks(
    "is read from its source in a cycle of references whose projects all list it",
    {
      "tsconfig.json": config(
        { ...strict, ...emitted, outDir: "out-a" },
        { include: ["*.ts"], ...circular("./tsconfig.other.json") },
      ),
      "tsconfig.other.json": config(
        { ...strict, ...emitted, outDir: "out-b" },
        { include: ["*.ts"], ...circular("./tsconfig.json") },
      ),
      "globals.d.ts": globals,
      "a.ts": wrong,
    },
    [assignment("a.ts")],
    [["a.ts"]],
  );
  // `a` is the loose one. Without it, the file has the options of no project, which are strict.
  checks(
    "is of the first project of such a cycle that lists it",
    {
      "tsconfig.json": JSON.stringify({ files: [], ...references("./tsconfig.a.json") }),
      "tsconfig.a.json": config(
        { ...loose, ...emitted, outDir: "out-a" },
        { include: ["*.ts"], ...circular("./tsconfig.b.json") },
      ),
      "tsconfig.b.json": config(
        { ...strict, ...emitted, outDir: "out-b" },
        { include: ["*.ts"], ...circular("./tsconfig.a.json") },
      ),
      "globals.d.ts": globals,
      "f.ts": implicit + wrong,
    },
    [assignment("f.ts", 4)],
    [["f.ts"]],
  );
});

describe("--check", () => {
  // The text that is printed is not in the source.
  const ran = `console.log("it " + "ran");\n`;
  const withConsole = `${globals}declare var console: { log(...args: unknown[]): void };\n`;
  /** The codes that `cmd` prints, whether the entry point ran, and the exit code. */
  async function outcome(files: Files, cmd: string[]) {
    using dir = tempDir("bun-check-project-of-file", files);
    const { stdout, stderr, exitCode } = await run(String(dir), cmd);
    return { codes: [...new Set((stdout + stderr).match(/\bTS\d+/g))], ran: stdout.includes("it ran"), exitCode };
  }
  const stopped = (code: string) => ({ codes: [code], ran: false, exitCode: 1 });
  // Both list everything. The nearest one is the loose one.
  const shared = (source: string) => ({
    "tsconfig.json": config({ ...loose, noEmit: true }, references("./tsconfig.build.json")),
    "tsconfig.build.json": config({ ...strict, ...emitted, outDir: "dist" }),
    "globals.d.ts": withConsole,
    "main.ts": `import { n } from "./imported";\nexport const m: number = n;\n${ran}`,
    "start.js": `import { n } from "./imported";\nexport const m = n;\n${ran}`,
    "imported.ts": source,
    "main.test.ts": `import { n } from "./imported";\nexport const m: number = n;\n${ran}`,
  });

  const build = `const { success, logs } = await Bun.build({ entrypoints: ["main.ts"], outdir: "out", check: true, throw: false });
    for (const log of logs) console.error(log.message);
    process.exit(success ? 0 : 1);`;
  test.each([
    ["bun --check", ["--check", "main.ts"]],
    ["bun run --check", ["run", "--check", "main.ts"]],
    ["bun build --check", ["build", "--check", "main.ts", "--outdir", "out"]],
    ["bun build --no-bundle --check", ["build", "--no-bundle", "--check", "main.ts"]],
    ["bun test --check", ["test", "--check", "main.test.ts"]],
    ["Bun.build", ["-e", build]],
    // No project lists it: it is of the referenced one, which would under `allowJs`.
    ["bun --check, JavaScript", ["--check", "start.js"]],
    ["bun build --check, JavaScript", ["build", "--check", "start.js", "--outdir", "out"]],
  ])("does not run an entry point that both list, if what it imports has a type error: %s", async (_, cmd) => {
    const files = shared(`export const n: number = "1";\n`);
    expect(await outcome(files, cmd)).toEqual(stopped("TS2322"));
  });

  test.each(["main.ts", "start.js"])("runs it if there is none: bun --check %s", async entry => {
    const files = shared(`export const n: number = 1;\n`);
    expect(await outcome(files, ["--check", entry])).toEqual({ codes: [], ran: true, exitCode: 0 });
  });

  test.each([
    ["client.ts", implicit],
    // It is JavaScript, which no project lists, and what it imports is TypeScript.
    ["client.js", `import "./typed";\n`],
  ])("checks the script of a page in the referenced project: %s", async (script, source) => {
    const files = {
      "tsconfig.json": config({ ...loose, noEmit: true }, references("./tsconfig.client.json")),
      "tsconfig.client.json": config(
        { ...strict, ...emitted, outDir: "out" },
        { include: ["client.*", "typed.ts", "globals.d.ts"] },
      ),
      "globals.d.ts": withConsole,
      "html.d.ts": `declare module "*.html" {\n  const page: unknown;\n  export default page;\n}\n`,
      "index.html": `<!doctype html><script type="module" src="./${script}"></script>\n`,
      [script]: source,
      "typed.ts": implicit,
      "server.ts": `/// <reference path="./html.d.ts" />\nimport page from "./index.html";\nexport { page };\n${ran}`,
    };
    expect(await outcome(files, ["--check", "server.ts"])).toEqual(stopped("TS7006"));
  });

  // The nearest tsconfig.json does not allow JavaScript, so it does not list the entry point.
  const javascript = (more: object) => ({
    "tsconfig.json": config({ ...strict, noEmit: true }, references("./tsconfig.node.json")),
    "tsconfig.node.json": config(
      { ...strict, ...emitted, ...more, outDir: "out" },
      { include: ["conf.js", "globals.d.ts"] },
    ),
    "globals.d.ts": withConsole,
    "conf.js": `/** @type {number} */\nexport const wrong = "";\n${ran}`,
    "src/a.ts": `export const ok = 1;\n`,
  });

  test("a JavaScript entry point is of the referenced project that lists it", async () => {
    const files = javascript({ allowJs: true, checkJs: true });
    expect(await outcome(files, ["--check", "conf.js"])).toEqual(stopped("TS2322"));
  });

  test("a JavaScript entry point is of the project that lists it, before one that would", async () => {
    // The first would list it under `allowJs`, and the second does.
    const files = {
      "tsconfig.json": JSON.stringify({ files: [], ...references("./tsconfig.app.json", "./tsconfig.tools.json") }),
      "tsconfig.app.json": config(
        { ...strict, ...emitted, outDir: "out-app" },
        { include: ["scripts", "globals.d.ts"] },
      ),
      "tsconfig.tools.json": config(
        { ...strict, ...emitted, allowJs: true, checkJs: true, outDir: "out-tools" },
        { include: ["scripts", "globals.d.ts"] },
      ),
      "globals.d.ts": withConsole,
      "scripts/x.js": `/** @type {number} */\nexport const wrong = "";\n${ran}`,
    };
    expect(await outcome(files, ["--check", "scripts/x.js"])).toEqual(stopped("TS2322"));
  });

  test("a JavaScript entry point that only the nearest project allows is of that project", async () => {
    const files = {
      "tsconfig.json": config(
        { ...strict, allowJs: true, checkJs: true, noEmit: true },
        references("./tsconfig.node.json"),
      ),
      "tsconfig.node.json": config({ ...strict, ...emitted, outDir: "out" }, { include: ["scripts", "globals.d.ts"] }),
      "globals.d.ts": withConsole,
      "scripts/seed.js": `/** @type {number} */\nexport const wrong = "";\n${ran}`,
      "scripts/util.ts": `export const ok = 1;\n`,
    };
    expect(await outcome(files, ["--check", "scripts/seed.js"])).toEqual(stopped("TS2322"));
  });

  test("a JavaScript entry point that no project lists is of the referenced one that would", async () => {
    // `dep.ts` has the options of tsconfig.node.json, which are the loose ones here.
    const files = {
      ...javascript({ strict: false }),
      "conf.js": `import { f } from "./dep";\nf(1);\n${ran}`,
      "dep.ts": implicit,
    };
    expect(await outcome(files, ["--check", "conf.js"])).toEqual({ codes: [], ran: true, exitCode: 0 });
  });
});
