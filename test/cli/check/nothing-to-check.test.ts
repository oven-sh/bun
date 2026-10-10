// `bun check <paths>`: a path names a file or a directory to check, and a project is named with `-p` or `-b`. A run whose
// paths have no TypeScript file does not pass.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  // Of the script that runs the tests.
  npm_lifecycle_event: undefined,
  npm_package_json: undefined,
  BUN_INTERNAL_CHECK_SCRIPTS: undefined,
  NO_COLOR: "1",
};

// `lib: ["es5"]`: three library files in place of eighty, which a debug build takes long to read.
const options = { strict: true, noEmit: true, lib: ["es5"], types: [], skipLibCheck: true };
const tsconfig = JSON.stringify({ compilerOptions: options });

// One type error, in `src/a.ts`.
const project = (files: Record<string, string> = {}) =>
  tempDir("bun-check", {
    "tsconfig.json": tsconfig,
    "tsconfig.build.json": `{ "extends": "./tsconfig.json" }`,
    "jsconfig.json": `{}`,
    "configs/base.json": tsconfig,
    "package.json": `{ "name": "app" }`,
    "args.txt": "tsconfig.build.json",
    "src/a.ts": `export const wrong: number = "";\n`,
    "src/ok.ts": `export const ok = 1;\n`,
    "src/tsconfig.ts": `export const named = 1;\n`,
    "types/globals.d.ts": `declare const broken: NoSuchType;\n`,
    "data/d.json": `{ "k": 1 }`,
    "empty/README.md": "",
    "empty2/README.md": "",
    ...files,
  });
const error = `src/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`;

// Whether the file system takes `A` for `a`, where the projects of these tests are.
const foldsCase = (() => {
  using dir = tempDir("bun-check", { "probe": "" });
  return existsSync(join(String(dir), "PROBE"));
})();

// `cwd` may be another spelling of `root`, which is what the output has.
async function run(cwd: string, cmd: string[], root = cwd) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const clean = (text: string) => text.replaceAll("\\", "/").replaceAll(root.replaceAll("\\", "/"), "<dir>").trim();
  return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
}

const check = (dir: { toString(): string }, args: string[]) => run(String(dir), ["check", ...args]);
const outcome = ({ stdout, exitCode }: { stdout: string; exitCode: number }) => ({ stdout, exitCode });

const isConfig = (config: string) => ({
  stdout: [
    `error: '${config}' is a configuration file, not a file to check`,
    `To use it as the project: bun check -p ${config}`,
    `To use it with the projects it references: bun check -b ${config}`,
    `To check the project here: bun check`,
  ].join("\n"),
  exitCode: 1,
});
const nothing = (path: string) => ({
  stdout: `error: Nothing to check: no TypeScript files in '<dir>/${path}'`,
  exitCode: 1,
});

// One process for each test, one test at a time: a debug build is slow to start, and slower beside others.
describe("a run that names only configuration files", () => {
  test.each([
    [["tsconfig.build.json"], "tsconfig.build.json"],
    [["tsconfig.json"], "tsconfig.json"],
    [["jsconfig.json"], "jsconfig.json"],
    [["<dir>/tsconfig.build.json"], "tsconfig.build.json"],
    [["--", "tsconfig.build.json"], "tsconfig.build.json"],
    [["@args.txt"], "tsconfig.build.json"],
    // The first of them.
    [["tsconfig.build.json", "tsconfig.json"], "tsconfig.build.json"],
    // The one that `-p` names, whatever its name is.
    [["-p", "configs/base.json", "configs/base.json"], "configs/base.json"],
    // The list would be that of the nearest project.
    [["--listFilesOnly", "tsconfig.build.json"], "tsconfig.build.json"],
  ])("is refused, with the commands that take one: %j", async (args, config) => {
    using dir = project();
    const there = args.map(arg => arg.replace("<dir>", String(dir)));
    expect(outcome(await check(dir, there))).toEqual(isConfig(config));
  });

  // Each of these is an error of its own once the project is read.
  test.each([
    ["an option of tsconfig.json that is wrong", { "tsconfig.json": `{ "compilerOptions": { "strict": "yes" } }` }],
    ["a tsconfig.build.json that does not parse", { "tsconfig.build.json": `{ "extends": "./tsconfig.json"` }],
    [
      "a project that takes no JSON file",
      { "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, resolveJsonModule: false } }) },
    ],
  ])("is refused before the project is read: %s", async (_, files) => {
    using dir = project(files);
    const { stdout, stderr, exitCode } = await check(dir, ["--timing", "tsconfig.build.json"]);
    expect({ stdout, exitCode }).toEqual(isConfig("tsconfig.build.json"));
    expect(stderr).toMatch(/^\s*0 files loaded/m);
  });

  test("is refused where no tsconfig.json is at the root", async () => {
    using dir = project({ "packages/app/tsconfig.json": tsconfig, "packages/app/a.ts": `export {};\n` });
    rmSync(join(String(dir), "tsconfig.json"));
    const refused = await check(dir, ["packages/app/tsconfig.json"]);
    expect(outcome(refused)).toEqual(isConfig("packages/app/tsconfig.json"));
  });

  test.each(["tsconfig.json", "tsconfig.app.json"])(
    "is refused beside a tsconfig.json with nothing but references: %s",
    async config => {
      using dir = project({
        "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
        "tsconfig.app.json": tsconfig,
      });
      expect(outcome(await check(dir, [config]))).toEqual(isConfig(config));
    },
  );

  test.each([0, 1, 2])("is told a command that checks the project: line %i of 3", async line => {
    using dir = project();
    const { stdout } = await check(dir, ["tsconfig.build.json"]);
    const commands = [...stdout.matchAll(/: bun (check.*)$/gm)].map(match => match[1].split(" "));
    expect(commands.length).toBe(3);
    expect(outcome(await run(String(dir), commands[line]))).toEqual({ stdout: error, exitCode: 1 });
  });

  test.skipIf(!foldsCase)("is named from the working directory, however that is spelled", async () => {
    using dir = project();
    const root = String(dir);
    const respelled = join(dirname(root), basename(root).toUpperCase());
    const refused = await run(respelled, ["check", "tsconfig.build.json"], root);
    expect(outcome(refused)).toEqual(isConfig("tsconfig.build.json"));
  });

  test("is not what a directory with such a name is", async () => {
    using dir = project({ "tsconfig.old.json/a.ts": `export const wrong: number = "";\n` });
    const checked = await check(dir, ["tsconfig.old.json"]);
    expect(outcome(checked)).toEqual({ stdout: error.replace("src/", "tsconfig.old.json/"), exitCode: 1 });
  });

  // Before something runs, it is the module to run.
  test("is not refused by `bun --check`", async () => {
    using dir = tempDir("bun-check", { "tsconfig.empty.json": `{}` });
    const ran = await run(String(dir), ["--loader", ".json:ts", "--check", "tsconfig.empty.json"]);
    expect({ isRefused: ran.stderr.includes("is a configuration file"), exitCode: ran.exitCode }).toEqual({
      isRefused: false,
      exitCode: 0,
    });
  });
});

describe("a run whose paths have no TypeScript file", () => {
  test.each([
    [["package.json"], "package.json"],
    [["-p", "tsconfig.build.json", "package.json"], "package.json"],
    [["data/d.json"], "data/d.json"],
    // A configuration file whose name does not say so.
    [["configs/base.json"], "configs/base.json"],
    // The first of them.
    [["./tsconfig.json", "package.json"], "tsconfig.json"],
    [["empty", "package.json"], "empty"],
    // These two are refused before anything is read, as they were.
    [["data"], "data"],
    [["empty", "empty2"], "empty"],
  ])("is refused: %j", async (args, path) => {
    using dir = project();
    expect(outcome(await check(dir, args))).toEqual(nothing(path));
  });

  test("is refused where there is no tsconfig.json", async () => {
    using dir = tempDir("bun-check", { "package.json": `{ "name": "app" }` });
    expect(outcome(await check(dir, ["--lib", "es5", "package.json"]))).toEqual(nothing("package.json"));
  });

  // A project of JSON files alone. Without a path, what its configuration file selects is its own affair.
  test.each([
    [[], { stdout: "", exitCode: 0 }],
    [["."], { stdout: "error: Nothing to check: no TypeScript files in '<dir>'", exitCode: 1 }],
    [["locales"], nothing("locales")],
    [["locales/de.json"], nothing("locales/de.json")],
  ])("is refused where the project includes the JSON files: %j", async (args, expected) => {
    using dir = tempDir("bun-check", {
      "tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["locales/*.json"] }),
      "locales/de.json": `{ "hello": "hallo" }`,
    });
    expect(outcome(await check(dir, args))).toEqual(expected);
  });

  test.each(["package.json", "tsconfig.build.json"])("is refused without the text under `--quiet`: %s", async path => {
    using dir = project();
    expect(outcome(await check(dir, ["--quiet", path]))).toEqual({ stdout: "", exitCode: 1 });
  });

  // `skipLibCheck` leaves the file out, as it does where no path is named. lint-staged names a staged `.d.ts` file by
  // itself.
  test.each([[["types/globals.d.ts"]], [["types"]], [["types/globals.d.ts", "package.json"]]])(
    "passes if one of the paths has a declaration file: %j",
    async args => {
      using dir = project();
      expect(outcome(await check(dir, args))).toEqual({ stdout: "", exitCode: 0 });
    },
  );

  // Nothing is said of the other paths, and a configuration file among them is not the project.
  test.each([
    [["src/ok.ts", "package.json"], { stdout: "", exitCode: 0 }],
    [["src/tsconfig.ts"], { stdout: "", exitCode: 0 }],
    [["tsconfig.build.json", "src/a.ts"], { stdout: error, exitCode: 1 }],
    [["src", "tsconfig.build.json"], { stdout: error, exitCode: 1 }],
  ])("is not what a path with a TypeScript file makes: %j", async (args, expected) => {
    using dir = project();
    expect(outcome(await check(dir, args))).toEqual(expected);
  });

  test("is listed by `--listFilesOnly`", async () => {
    using dir = project();
    const { stdout, exitCode } = await check(dir, ["--listFilesOnly", "package.json"]);
    expect(stdout.split("\n").at(-1)).toBe("<dir>/package.json");
    expect(exitCode).toBe(0);
  });

  test.each(["tsconfig.build.json", "package.json"])("is not named beside a path that is missing: %s", async path => {
    using dir = project();
    const missing = await check(dir, ["nope.ts", path]);
    expect(outcome(missing)).toEqual({ stdout: "error TS6053: File '<dir>/nope.ts' not found.", exitCode: 1 });
  });

  test("is not named where a JSON file has a syntax error", async () => {
    using dir = project({ "data/bad.json": `not json {` });
    const { stdout, exitCode } = await check(dir, ["data/bad.json"]);
    const places = stdout.split("\n").map(line => line.replace(/\(\d+,\d+\): error TS1\d+: .*$/, ""));
    expect([...new Set(places)]).toEqual(["data/bad.json"]);
    expect(exitCode).toBe(1);
  });

  test("is not named where the project takes no JSON file", async () => {
    using dir = project({
      "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, resolveJsonModule: false } }),
    });
    const { stdout, exitCode } = await check(dir, ["data/d.json"]);
    expect(stdout.split("\n")[0]).toStartWith("error TS6054: File '<dir>/data/d.json' has an unsupported extension.");
    expect(stdout).not.toContain("Nothing to check");
    expect(exitCode).toBe(1);
  });
});
