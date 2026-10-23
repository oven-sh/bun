// Runs every program under ./programs three ways, and the three outputs must agree: plain `bun run`, built with
// `bun build --compile --aot`, and built once more with `--aot-erase-types` (not for a program without a TypeScript file, which has
// no type to erase). The output of plain Bun is computed on the spot, so nothing is stored for a program that behaves the same in
// all three. Each <topic>.test.ts next to this file runs one folder of programs, or one part of a large folder; each
// variant-<name>.test.ts runs the quick subset again with flags that force the compiler down a path small programs do not take.
//
//   programs/<topic>/<name>.ts            a program in a single file (.ts, .tsx, .mts, .cts, .js, .mjs or .cjs); its first line says what it tests.
//                                         Programs that differ in the extension alone share the name of their test and the files beside them
//   programs/<topic>/<name>/main.ts       a program that consists of several files (main.ts, .tsx, .mts, .cts, .js, .mjs or .cjs)
//   <program>.expected.txt                the output under --aot where it is meant to differ from plain Bun, for example
//                                         because a value that does not match its declared type throws a TypeError
//   <program>.erased.txt                  the output under --aot --aot-erase-types where that is meant to differ from plain Bun too:
//                                         the difference does not come from a type (a locked built-in, `f.caller`). Same text form
//                                         as .expected.txt. Without it the build with erased types must print what plain Bun prints
//   <program>.build-errors.txt            the build must fail with exit code 1 and exactly these `error:` lines
//   <program>.todo.txt                    the program fails today, and why; it is listed as a todo and not run
//   <program>.json                        { "build": [flags for `bun build`], "buildEnv": { .. }, "env": { .. }, "reference": "compiled" }
//                                         "build": hidden --aot-<word> flags included. Whatever changes the generated code is a flag
//                                         "entryPoints": further entry points, behind the program's own, which stays the one that starts.
//                                         A computed import() or require() finds an entry point and no other file of the executable
//                                         "buildEnv": only the six BUN_JSC_* options that log (loggingOptions below); any other fails the test
//                                         "compiled": compare with `bun build --compile` without --aot, for features that
//                                         only the bundler provides (--define, --feature, files imported as text)
//                                         "skipInShell": why shell/quick.py skips the program; not read here
//                                         "skipWithASAN": why a Bun built with AddressSanitizer skips the program
//                                         "runWithASAN": why a Bun built with AddressSanitizer runs the program even where the quick subset leaves it out
//                                         "skipInVariants": why variant() leaves the program out
//                                         "skipInVariant": { "<label>": why variant("<label>", ..) or programsBuiltWith(.., "<label>", ..) alone leaves the program out }
//   // STATISTIC: <name> (= | >= | <=) <n>  a line of the entry point: what the build counted under that `StatisticId`, as the hidden `--explain=statistics` prints it.
//                                         It shows that an optimization ran on a host built-in, which `testaot` and so shell/expectations.py do not have.
//                                         Checked on the build that keeps the types, and not where a variant adds build flags
//   programs/**/tsconfig.json             the compiler options for the programs below it
//   programs/jsc-shell-functions.ts       noInline(), gc() and similar functions, for the programs that import it
//   programs/changes-to-builtins.js       tries every way to change a property of a built-in object, for the programs about locked built-ins
//   programs/changes-to-builtins-sloppy.cjs  the store and the `delete` in sloppy code, for changes-to-builtins.js
//   programs/generate-copies-born-in-their-holders.ts  writes the programs of copies-born-in-their-holders
//   programs/generate-nothing-throws-because-of-a-type.ts  writes the generated programs of nothing-throws-because-of-a-type
//   programs/generate-replaced-iteration.ts  writes built-ins-on-written-structure/lists-whose-iteration-is-replaced.js
//   programs/generate-type-predicates.ts  writes the programs of type-predicates
//   programs/commonjs/describe-object.cjs prints everything a program can observe about the own properties of an object, for the programs about the exports object of a CommonJS module
//   programs/strings/regexps-built-at-start.cjs  the tokens that regexps-built-at-start.ts and its twin put together
//   programs/untyped-speed/commonjs-package/lib/*.js  the modules that index.js of the package requires
//                                         A file directly in ./programs is a helper. One in the folder of a topic is a program unless `helpers` below lists it
//   packages/, packages-<topic>.test.ts   programs that import packages, with a runner of their own: packages/run-packages.ts
//
//   bun test test/aot                                     one program in ten, others for each commit of Bun (see `inShare` below); of packages/, one importer in ten and at least one per case
//   bun test test/aot/strings                             one topic, the same
//   AOT_SHARE=all bun test test/aot                       every program
//   AOT_SHARE=<revision> bun test test/aot                the programs that the Bun of that revision takes
//   AOT_PROGRAMS=quick bun test test/aot                  one program in ten, the same ones every time
//   AOT_PROGRAMS= bun test test/aot                       everything, packages/ too, even with a debug or ASAN build of Bun
//   AOT_PROGRAMS=replace bun test test/aot/strings        the programs whose path contains the text
//   AOT_PROGRAMS_JOBS=4 bun test ..                       how many programs run at once (default: one per core)
//   AOT_PROGRAMS_UPDATE=1 bun test ..                     rewrites the .expected.txt, .erased.txt and .build-errors.txt files that exist
//
// shell/ has two tools for working on the compiler without building Bun; perf/ has an opt-in performance test; servers/ has
// opt-in tests of HTTP servers written with Bun.serve, node:http and popular frameworks, and the tools that measure them.
// generated-code.test.ts runs shell/expectations.py, which checks the `// IR`, `// CALLS` and `// COUNTER:` lines and the `//!` comments of the programs, where its tools are built.
// every-program-folder-has-a-runner.test.ts fails where a folder of programs has no <topic>.test.ts or lacks one of its parts.
//
// Terms used in the first lines of the programs:
//   plain Bun             `bun run` on the same file, without --aot
//   typed object          an object created where TypeScript knows its type: a class instance or an object literal in a
//                         TypeScript file. --aot gives it a fixed layout and checks what is stored into its fields.
//   untyped code          JavaScript files, and TypeScript that works through `any`. It is compiled too, without type information.
//   runtime type check    where a value flows from untyped code into a declared type, --aot checks it and throws a TypeError
//                         if it does not match. Plain JavaScript has no such check, so these programs have an .expected.txt.
//   predicted             what the compiler expects but cannot prove, such as the callee of a call. It is checked at run time,
//                         and a wrong prediction costs time but never changes the result.
//   internal representation (of a string)
//                         how JavaScriptCore stores it: 8-bit or 16-bit; flat, rope (a concatenation that has not been
//                         flattened yet) or substring of another string
//
// Some topics come in pairs, and many programs have a counterpart of the same name in the other folder:
//   typed-objects         typed objects must behave exactly as in plain JavaScript here
//   type-rules            where --aot differs from plain Bun on purpose; most have an .expected.txt or a .build-errors.txt
//   calls-fast-paths      what the generated code must look like, stated in `// IR` and `// CALLS` lines for shell/expectations.py
//   calls                 the cases in which those optimizations must not change the result
//   untyped-code          code without type information
//   untyped-stress        the same, ported from stress tests that were written for the `jsc` shell
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { availableParallelism, tmpdir } from "os";
import { join, relative } from "path";

const root = join(import.meta.dir, "programs");
// A debug or ASAN build of Bun is many times slower, so it runs the quick subset unless told otherwise.
export const wanted = process.env.AOT_PROGRAMS ?? (isASAN || isDebug ? "quick" : "");
const updates = !!process.env.AOT_PROGRAMS_UPDATE;

// CI has four cores for five minutes a file, and every program in every way would take it a day for each commit. So a run that is told nothing takes a share of the programs, and which
// share follows from the revision of the Bun under test: each commit takes others, and in time all are taken. A test is named after its program, so AOT_PROGRAMS=<name> runs a red again.
const seedOfShare = process.env.AOT_SHARE ?? Bun.revision;
const takesEverything = seedOfShare === "all" || process.env.AOT_PROGRAMS !== undefined || wanted === "quick" || updates;
let hasSaidShare = false;

/** For a tool that takes every n-th program, starting at the i-th, as `<i>/<n>`: part `part` of `parts`, or, in a run that takes a share, one of `oneIn` pieces of that part. */
export function partInShare(part: number, parts: number, oneIn: number): string {
  if (takesEverything) return `${part}/${parts}`;
  return `${part + parts * Number(BigInt(Bun.hash(seedOfShare)) % BigInt(oneIn))}/${parts * oneIn}`;
}

/** Whether this run takes the program, the case or the pair `name`, of whose kind a run takes one in `oneIn`. */
export function inShare(name: string, oneIn: number): boolean {
  if (takesEverything) return true;
  if (!hasSaidShare) console.error(`SHARE: this run takes a part of the programs. AOT_SHARE=${seedOfShare} takes the same part, AOT_SHARE=all takes all of them`);
  hasSaidShare = true;
  return BigInt(Bun.hash(seedOfShare + " " + name.replaceAll("\\", "/"))) % BigInt(oneIn) === 0n;
}

// One build takes about as long as the whole default limit of bun:test. This holds for every file that imports this one or supported.ts.
setDefaultTimeout(120_000);

// Not every build of Bun includes the compiler. One without it says so before it looks for the entry point.
export const unsupported = /^error: --aot ((?:only supports|isn't available) .*)$/m.exec(
  Bun.spawnSync({ cmd: [bunExe(), "build", "--compile", "--aot", "./no-such-file.ts"], cwd: root, env: bunEnv, stdout: "ignore", stderr: "pipe" }).stderr.toString(),
)?.[1];
if (unsupported) console.error(`SKIPPED: the tests of --aot in this file: ${unsupported}`);

// The files in the folder of a topic that programs load and that are no programs themselves. shell/quick.py has the same list.
const helpers = new Set([
  "commonjs/describe-object.cjs",
  "strings/regexps-built-at-start.cjs",
  "untyped-speed/commonjs-package/lib/format.js",
  "untyped-speed/commonjs-package/lib/queue.js",
  "untyped-speed/commonjs-package/lib/util.js",
]);

function find(folder: string, into: string[]) {
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  const main = entries.find(entry => entry.isFile() && /^main\.([cm]?[jt]s|tsx)$/.test(entry.name));
  if (main) return void into.push(join(folder, main.name));
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) find(path, into);
    else if (/\.([cm]?[jt]s|tsx)$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name) && !helpers.has(relative(root, path).replaceAll("\\", "/"))) into.push(path);
  }
}

// Each build keeps one core busy for about a second and writes an executable the size of Bun.
let free = Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism());
const waiting: (() => void)[] = [];
export async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}

export async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  // A child that hangs is killed here, and the signal fails the test. A test that merely timed out would leave it running.
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 90_000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}

export const withoutCoreDump = (cmd: string[]) => (isWindows ? cmd : ["/bin/sh", "-c", `ulimit -c 0 && exec "$@"`, "--", ...cmd]);

/** The parts of a run's result that must be equal between two ways of running a program. */
export function told(run: { stdout: string; stderr: string; exitCode: number }) {
  return {
    // A duration that a program measures is not part of its behavior.
    stdout: run.stdout.replace(/ [0-9]+ms$/gm, ""),
    // For an uncaught error, only the line that names the error: the stack frames below it contain file paths, which differ
    // between an executable and the sources. Otherwise everything but the number of the process, with which a warning begins,
    // and the name of the executable in the hint below it.
    stderr:
      run.exitCode === 0
        ? run.stderr.replace(/^\(node:[0-9]+\) /gm, "(node) ").replace(/^\(Use `[^`\n]* --trace-warnings /gm, "(Use `bun --trace-warnings ")
        : (run.stderr.split("\n").find(line => /^(error|[A-Za-z]*Error)\b/.test(line)) ?? ""),
    exitCode: run.exitCode,
  };
}

export function built(build: { stderr: string; exitCode: number }) {
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
}

// Every build writes the Bun that runs it once more, and CI tests bun-profile, which on Linux has its debug information in it:
// three times the bytes of the Bun that ships. A file of many programs builds on a copy without it. The copy lies in the
// temporary directory under a name that tells this Bun from any other. It is made once and found again by every test file,
// process and run, so no test removes it; whoever makes one removes those that nobody has used for a day.
export function withoutDebugInformation(_folder?: string): string[] {
  const strip = isLinux && Bun.which("strip");
  const { ino, size, mtimeMs } = statSync(bunExe());
  if (!strip || size < 200 * 1024 * 1024) return [];
  const prefix = "bun-without-debug-information-";
  const copy = join(tmpdir(), `${prefix}${ino}-${size}-${Math.trunc(mtimeMs)}`);
  if (existsSync(copy)) {
    utimesSync(copy, new Date(), new Date());
    return ["--compile-executable-path", copy];
  }
  for (const name of readdirSync(tmpdir())) {
    if (name.startsWith(prefix) && Date.now() - statSync(join(tmpdir(), name)).mtimeMs > 24 * 60 * 60 * 1000) rmSync(join(tmpdir(), name), { force: true });
  }
  const unfinished = `${copy}.${process.pid}`;
  if (Bun.spawnSync({ cmd: [strip, "-o", unfinished, bunExe()], stdout: "ignore", stderr: "ignore" }).exitCode !== 0) {
    rmSync(unfinished, { force: true });
    return [];
  }
  renameSync(unfinished, copy);
  return ["--compile-executable-path", copy];
}

let executables = 0;

type ProgramOptions = { build?: string[]; entryPoints?: string[]; buildEnv?: Record<string, string>; env?: Record<string, string>; reference?: "compiled" };
// How the programs of one describe() are built and run.
type Setup = { folder: string; carrier: string[]; buildFlags: string[]; runEnv: Record<string, string>; erasesTypes: boolean; stubCopies?: number };
export type RunResult = ReturnType<typeof told>;
export type StatisticBound = { name: string; relation: "=" | ">=" | "<="; bound: number };

/** One build with --aot, and the environments in which its executable runs. */
export type CompiledProgram = {
  cwd: string;
  entryPoints: string[];
  carrier: string[];
  buildFlags: string[];
  runEnvironments: Record<string, string>[];
  buildEnvironment?: Record<string, string>;
  /** Where the executable is written. Default: `cwd`. */
  outputFolder?: string;
  /** What the build must have counted. */
  statistics?: StatisticBound[];
  /** The build must have laid out more than one copy of the shared stubs. */
  stubCopiesExpected?: boolean;
};

const loggingOptions = new Set(["logAOTPhaseTimes", "dumpAOTIR", "dumpAOTB3Graph", "dumpAOTDisassembly", "aotFunctionToDump", "aotMapFilePath"].map(name => `BUN_JSC_${name}`));

const nextExecutablePath = (folder: string, name: string) => join(folder, `${name}-${executables++}${isWindows ? ".exe" : ""}`);

const isTypeScriptFile = (name: string) => /\.(ts|tsx|mts|cts)$/.test(name) && !/\.d\.[mc]?ts$/.test(name);

/** Is a file of the program TypeScript? If not, there is no type to erase: the build with --aot-erase-types would compile the same program again. */
export function hasTypes(path: string): boolean {
  if (!/[\\/]main\.[a-z]+$/.test(path)) return isTypeScriptFile(path);
  return readdirSync(join(path, ".."), { recursive: true, encoding: "utf8" }).some(name => isTypeScriptFile(name));
}

function readStatisticBounds(path: string): StatisticBound[] {
  return Array.from(readFileSync(path, "utf8").matchAll(/^\/\/ STATISTIC\b(.*)$/gm), ([line, rest]) => {
    const [, name, relation, bound] = /^: (\w+) (=|>=|<=) (\d+)$/.exec(rest) ?? [];
    if (name === undefined) throw new Error(`${path}: "${line}" is not of the form "// STATISTIC: <name> (= | >= | <=) <n>"`);
    return { name, relation: relation as StatisticBound["relation"], bound: Number(bound) };
  });
}

function expectStatistics(buildOutput: string, bounds: StatisticBound[]) {
  const counted = new Map(Array.from(buildOutput.matchAll(/^(\w+) (\d+)$/gm), ([, name, value]) => [name, Number(value)] as const));
  const isMet = ({ name, relation, bound }: StatisticBound) => {
    const value = counted.get(name);
    if (value === undefined) return false;
    return relation === "=" ? value === bound : relation === ">=" ? value >= bound : value <= bound;
  };
  const unmet = bounds.filter(bound => !isMet(bound));
  expect(unmet.map(({ name, relation, bound }) => `${name} ${relation} ${bound}, but the build counted ${counted.get(name) ?? "no such statistic"}`)).toEqual([]);
}

// The check of references reads what B3's road leaves behind, so a build with it generates no code directly: a program that is here for the direct code generators is built without.
// There are none on Windows, and a Bun built with AddressSanitizer sends every function through B3, which puts the checks of the shadow memory into the code.
const generatesAllCodeDirectly = (program: CompiledProgram) => !isWindows && !isASAN && program.buildFlags.includes("--aot-testing=GenerateAllCodeDirectly");

async function buildCompiled(program: CompiledProgram) {
  const executable = nextExecutablePath(program.outputFolder ?? program.cwd, "program");
  const checks = generatesAllCodeDirectly(program) ? [] : ["--aot-check=validate-references"];
  const flags = [...checks, ...program.carrier, ...program.buildFlags, ...(program.statistics?.length || program.stubCopiesExpected || generatesAllCodeDirectly(program) ? ["--explain=statistics"] : [])];
  const cmd = [bunExe(), "build", "--compile", "--aot", ...flags, ...program.entryPoints, "--outfile", executable];
  return { ...(await spawned(cmd, program.cwd, { ...bunEnv, ...program.buildEnvironment })), executable };
}

/** Builds the program, runs its executable once in each environment and hands each result to `check`. */
async function runCompiled(program: CompiledProgram, check: (result: RunResult, environment: Record<string, string>) => void) {
  const build = await buildCompiled(program);
  try {
    built(build);
    expectStatistics(build.stderr, [
      ...(program.statistics ?? []),
      ...(program.stubCopiesExpected ? [{ name: "StubCopiesEmitted", relation: ">=", bound: 2 } as const] : []),
      ...(generatesAllCodeDirectly(program) ? [{ name: "FunctionsGeneratedDirectly", relation: ">=", bound: 1 } as const] : []),
    ]);
    for (const environment of program.runEnvironments) {
      const ran = await spawned(withoutCoreDump([build.executable]), program.cwd, { ...bunEnv, ...environment, BUN_AOT_VERBOSE: "1" });
      expect({ environment, signal: ran.signal, stderr: ran.signal ? ran.stderr : "" }).toEqual({ environment, signal: null, stderr: "" });
      // The executable really ran compiled code and did not fall back to the embedded source.
      expect(ran.stderr).toContain("[aot] module: ");
      check(told({ ...ran, stderr: ran.stderr.replace(/^\[aot\] .*\r?\n/gm, "") }), environment);
    }
  } finally {
    rmSync(build.executable, { force: true });
  }
}

/** Builds the program with --aot. In each of its environments the executable must do what `expected` says. `way` names the build where they differ. */
export async function expectCompiledOutput(way: string, program: CompiledProgram, expected: RunResult): Promise<void> {
  await runCompiled(program, (result, environment) => expect({ way, environment, ...result }).toEqual({ way, environment, ...expected }));
}

async function expectBuildErrors(program: CompiledProgram, stored: string) {
  const build = await buildCompiled(program);
  try {
    // Each distinct error counts once; how often it is repeated for different positions is not what is tested.
    const errors = [...new Set(build.stderr.split("\n").filter(line => line.startsWith("error: ")))].join("\n") + "\n";
    if (updates) writeFileSync(stored, errors);
    expect({ errors, exitCode: build.exitCode }).toEqual({ errors: readFileSync(stored, "utf8"), exitCode: 1 });
  } finally {
    rmSync(build.executable, { force: true });
  }
}

function expectStored(file: string, result: RunResult) {
  const text = result.stdout + (result.exitCode ? `exit code ${result.exitCode}\n${result.stderr}\n` : result.stderr);
  if (updates) writeFileSync(file, text);
  expect(text).toBe(readFileSync(file, "utf8"));
}

async function runReference(path: string, options: ProgramOptions, setup: Setup): Promise<RunResult> {
  const cwd = join(path, "..");
  const executable = nextExecutablePath(setup.folder, "reference");
  try {
    if (options.reference === "compiled") {
      const flags = (options.build ?? []).filter(flag => !flag.startsWith("--aot-"));
      built(await spawned([bunExe(), "build", "--compile", ...setup.carrier, ...flags, path, ...(options.entryPoints ?? []), "--outfile", executable], cwd, bunEnv));
    }
    const plain = await spawned(options.reference === "compiled" ? [executable] : [bunExe(), "run", path], cwd, { ...bunEnv, ...options.env });
    // A reference run that fails is useless: two runs that end with the same error would compare equal and prove nothing.
    expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
    return told(plain);
  } finally {
    rmSync(executable, { force: true });
  }
}

/** The lines of a map file, each split into its fields. */
const readMap = (mapFile: string) => readFileSync(mapFile, "utf8").split("\n").map(line => line.split("\t"));

/**
 * Lays the code of the program out as if calls reached only far enough to need about `copies` copies of the shared stubs, as in a very large program.
 * How far that is hangs on the program: which stubs it has and how much code. So it is built once as it is, for its map, and the flag is computed from that.
 * A program of one function never has two copies.
 */
async function withStubCopies(program: CompiledProgram, copies: number): Promise<CompiledProgram> {
  const mapFile = nextExecutablePath(program.outputFolder ?? program.cwd, "map");
  const build = await buildCompiled({ ...program, buildFlags: [...program.buildFlags, "--explain=statistics"], buildEnvironment: { ...program.buildEnvironment, BUN_JSC_aotMapFilePath: mapFile } });
  try {
    built(build);
    const lines = readMap(mapFile);
    const functionsEnd = Number(lines.find(fields => fields[0] === "R")?.[1]);
    const functionOffsets = lines.filter(fields => fields[0] === "F").map(fields => Number(fields[2]));
    // The stubs come first, then the functions.
    const functionsStart = functionOffsets.reduce((least, offset) => Math.min(least, offset), Infinity);
    const stubsSize = Number(/^SharedCodeBytesEmitted (\d+)$/m.exec(build.stderr)?.[1]);
    expect({ functionsStart, functionsEnd, stubsSize }).toEqual({ functionsStart: expect.any(Number), functionsEnd: expect.any(Number), stubsSize: expect.any(Number) });
    expect(functionsEnd).toBeGreaterThan(functionsStart);
    // A copy serves the functions on both of its sides from which its far end is within reach.
    const reach = stubsSize + Math.ceil((functionsEnd - functionsStart) / (2 * copies));
    return { ...program, buildFlags: [...program.buildFlags, `--aot-limit=direct-call-reach:${reach}`], stubCopiesExpected: functionOffsets.length >= 2 };
  } finally {
    rmSync(build.executable, { force: true });
    rmSync(mapFile, { force: true });
  }
}

async function run(path: string, beside: string, setup: Setup) {
  const options: ProgramOptions = existsSync(beside + ".json") ? JSON.parse(readFileSync(beside + ".json", "utf8")) : {};
  expect(Object.keys(options.buildEnv ?? {}).filter(name => !loggingOptions.has(name))).toEqual([]);
  const bounds = readStatisticBounds(path);
  const createProgram = (extraFlags: string[], statistics: StatisticBound[]): CompiledProgram => ({
    cwd: join(path, ".."),
    entryPoints: [path, ...(options.entryPoints ?? [])],
    carrier: setup.carrier,
    // A flag that holds one value takes its last spelling, so the flags of a variant win over those of the program.
    buildFlags: [...(options.build ?? []), ...setup.buildFlags, ...extraFlags],
    runEnvironments: [{ ...options.env, ...setup.runEnv }],
    buildEnvironment: options.buildEnv,
    outputFolder: setup.folder,
    statistics,
  });

  if (existsSync(beside + ".build-errors.txt")) {
    // A build that fails prints no statistics, so such a line would never be checked.
    expect(bounds).toEqual([]);
    return expectBuildErrors(createProgram([], []), beside + ".build-errors.txt");
  }
  // The flags of a variant change what the compiler does, and so do erased types: the counts hold for neither.
  const isBuiltAsWritten = setup.buildFlags.length === 0 && setup.stubCopies === undefined;
  const ways = [{ way: "compiled", stored: beside + ".expected.txt", program: createProgram([], isBuiltAsWritten ? bounds : []) }];
  if (setup.stubCopies !== undefined) ways[0].program = await withStubCopies(ways[0].program, setup.stubCopies);
  if (setup.erasesTypes && hasTypes(path)) ways.push({ way: "compiled with types erased", stored: beside + ".erased.txt", program: createProgram(["--aot-erase-types"], []) });
  let reference: RunResult | undefined;
  for (const { way, stored, program } of ways) {
    if (existsSync(stored)) await runCompiled(program, result => expectStored(stored, result));
    else await expectCompiledOutput(way, program, (reference ??= await runReference(path, options, setup)));
  }
}

const hash = (path: string) => BigInt(Bun.hash(relative(root, path).replaceAll("\\", "/")));
const isQuick = (path: string) => (hash(path) >> 8n) % 10n === 0n;
const besideOf = (path: string) => path.replace(/[\\/]main\.[a-z]+$/, "").replace(/\.[a-z]+$/, "");
const runsWithASAN = (path: string) => isASAN && existsSync(besideOf(path) + ".json") && !!JSON.parse(readFileSync(besideOf(path) + ".json", "utf8")).runWithASAN;

function define(title: string, chosen: string[], settings: Omit<Setup, "folder" | "carrier">) {
  const folder = String(tempDir("aot-programs", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const carrier = !unsupported && chosen.length >= 20 ? withoutDebugInformation() : [];

  describe.concurrent(title, () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    // A filter can leave a test file without any program.
    if (chosen.length === 0) test.skip("no program selected", () => {});
    for (const path of chosen) {
      const beside = besideOf(path);
      const name = relative(root, beside).replaceAll("\\", "/");
      const skipWithASAN: string | undefined = isASAN && existsSync(beside + ".json") ? JSON.parse(readFileSync(beside + ".json", "utf8")).skipWithASAN : undefined;
      if (existsSync(beside + ".todo.txt")) test.todo(name);
      else if (skipWithASAN) {
        console.error(`SKIPPED: ${name}: ${skipWithASAN}`);
        test.skip(name, () => {});
      }
      // The child processes have their own time limits; this one also covers the wait for a free slot.
      else test(name, () => slot(() => run(path, beside, { folder, carrier, ...settings })), 600_000);
    }
  });
}

/** Defines one test per program in a folder. A large folder is split into `parts` by a hash of the path. */
export function programs(topic: string, part = 1, parts = 1) {
  const all: string[] = [];
  find(join(root, topic), all);
  define(
    `compile/aot/${topic}`,
    all
      .filter(path => Number(hash(path) % BigInt(parts)) === part - 1)
      .filter(path => (wanted === "quick" ? isQuick(path) || runsWithASAN(path) : relative(root, path).includes(wanted)))
      .filter(path => inShare(relative(root, path), 10)),
    { buildFlags: [], runEnv: {}, erasesTypes: true },
  );
}

/**
 * Runs every program of one folder once more, built with other flags or run in another environment: for a folder whose programs
 * only bite there, as those about what a caller believes of a callee do where calls stay calls. Each program is built once and
 * compared with plain Bun: programs() covers the build with erased types. AOT_PROGRAMS selects as in programs(). A large folder is split into `parts` as there.
 * `only` names the programs of the folder that are run, without the folder and without an extension; a name that is not there fails.
 */
export function programsBuiltWith(topic: string, label: string, buildFlags: string[], runEnv: Record<string, string> = {}, part = 1, parts = 1, only?: readonly string[]) {
  const all: string[] = [];
  find(join(root, topic), all);
  const nameOf = (path: string) => besideOf(relative(join(root, topic), path)).replaceAll("\\", "/");
  const missing = only?.filter(name => !all.some(path => nameOf(path) === name)) ?? [];
  if (missing.length) throw new Error(`no such program in ${topic}: ${missing.join(", ")}`);
  define(
    `compile/aot/${topic}/${label}`,
    all
      .filter(path => !only || only.includes(nameOf(path)))
      .filter(path => Number(hash(path) % BigInt(parts)) === part - 1)
      .filter(path => (wanted === "quick" ? isQuick(path) || runsWithASAN(path) : relative(root, path).includes(wanted)))
      // A list of names is a list of programs that once went wrong so: all of them are taken.
      .filter(path => !!only || inShare(label + " " + relative(root, path), 10))
      .filter(path => !existsSync(besideOf(path) + ".build-errors.txt"))
      // As in variant(): <program>.json may say why the program is left out under this label.
      .filter(path => !existsSync(besideOf(path) + ".json") || !JSON.parse(readFileSync(besideOf(path) + ".json", "utf8")).skipInVariant?.[label]),
    { buildFlags, runEnv, erasesTypes: false },
  );
}

/**
 * Runs the quick subset of all topics once more, built with flags that force the compiler down a path which small programs
 * otherwise never take. Each program is built once and compared with plain Bun: programs() covers the build with erased types.
 * AOT_PROGRAMS=<text> selects other programs, as above. `runEnv` is set where the executable runs. A run that is told nothing takes a fortieth of that subset, by `inShare`.
 * It is split into `parts` as a large folder is. A build with a sanitizer takes a third of them. The programs `always` are taken in any case.
 * `stubCopies`: each program is laid out so that it needs about that many copies of the shared stubs.
 */
export function variant(label: string, buildFlags: string[], runEnv: Record<string, string> = {}, part = 1, parts = 1, always: string | string[] = [], stubCopies?: number) {
  const all: string[] = [];
  find(root, all);
  define(
    `compile/aot/variant/${label}`,
    all
      // A file directly in ./programs is a helper, not a program.
      .filter(path => /[\\/]/.test(relative(root, path)))
      .filter(
        path =>
          [always].flat().includes(besideOf(relative(root, path)).replaceAll("\\", "/")) ||
          ((wanted === "" || wanted === "quick" ? isQuick(path) : relative(root, path).includes(wanted)) &&
            inShare(label + " " + relative(root, path), 40) &&
            Number((hash(path) >> 16n) % BigInt(parts)) === part - 1 &&
            (!isASAN || (hash(path) >> 32n) % 3n === 0n)),
      )
      // Nothing is compiled for a program that the build rejects.
      .filter(path => !existsSync(besideOf(path) + ".build-errors.txt") && !existsSync(besideOf(path) + ".todo.txt"))
      .filter(path => {
        if (!existsSync(besideOf(path) + ".json")) return true;
        const { skipInVariants, skipInVariant } = JSON.parse(readFileSync(besideOf(path) + ".json", "utf8"));
        return !skipInVariants && !skipInVariant?.[label];
      }),
    { buildFlags, runEnv, erasesTypes: false, stubCopies },
  );
}

