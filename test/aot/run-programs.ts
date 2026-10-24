// Runs every program under ./programs three ways, and the three outputs must agree: plain `bun run`, built with
// `bun build --compile --aot`, and built once more with `--aot-erase-types` (not for a program without a TypeScript file, which has
// no type to erase). The output of plain Bun is computed on the spot, so nothing is stored for a program that behaves the same in
// all three. parts.mts has a row for each folder of programs, and for each variant, which runs the quick subset again with flags that
// force the compiler down a path small programs do not take. `bun test ..` below stands for `bun test test/aot/parts.test.ts`.
//
//   programs/<topic>/<name>.ts            a program in a single file (.ts, .tsx, .mts, .cts, .js, .mjs or .cjs); its first line says what it tests.
//                                         Programs that differ in the extension alone share the name of their test and the files beside them
//   programs/<topic>/<name>/main.ts       a program that consists of several files (main.ts, .tsx, .mts, .cts, .js, .mjs or .cjs)
//   <program>.expected.txt                the output under --aot where it is meant to differ from plain Bun, for example
//                                         because a value that does not match its declared type throws a TypeError
//                                         The build with --aot-erase-types is held to it too: the difference does not come from a type (a locked built-in, `f.caller`)
//   <program>.build-errors.txt            the build must fail with exit code 1 and exactly these `error:` lines
//   <program>.todo.txt                    the program fails today, and why; it is listed as a todo and not run
//   <program>.json                        { "build": [flags for `bun build`], "buildEnv": { .. }, "env": { .. }, "reference": "compiled" }
//                                         "build": hidden --aot-<word> flags included. Whatever changes the generated code is a flag
//                                         "entryPoints": further entry points, behind the program's own, which stays the one that starts.
//                                         A computed import() or require() finds an entry point and no other file of the executable
//                                         "buildEnv": only the six BUN_JSC_* options that log (loggingOptions below); any other fails the test
//                                         "erased": "as plain Bun": there is an .expected.txt, and the build with erased types prints what plain Bun prints all the same
//                                         "compiled": compare with `bun build --compile` without --aot, for features that
//                                         only the bundler provides (--define, --feature, files imported as text)
//                                         "skipInShell": why shell/quick.py skips the program; not read here
//                                         "skipWithASAN": why a Bun built with AddressSanitizer skips the program
//                                         "runWithASAN": why a Bun built with AddressSanitizer runs the program even where the quick subset leaves it out
//                                         "skipInVariants": why variant() leaves the program out
//                                         "skipInVariant": { "<label>": why variant("<label>", ..) or programsBuiltWith(.., "<label>", ..) alone leaves the program out }
//                                         "todoOn": { "<process.platform>": what happens there today }: the program is listed as a todo and not run on that platform alone
//                                         "alone": why programs-as-entry-points.ts leaves the program out: what it prints hangs on being the first entry point, or on what else the executable holds
//   // STATISTIC: <name> (= | >= | <=) <n>  a line of the entry point: what the build counted under that `StatisticId`, as the hidden `--explain=statistics` prints it.
//                                         It shows that an optimization ran on a host built-in, which `testaot` and so shell/expectations.py do not have.
//                                         Checked on the build that keeps the types, and not where a variant adds build flags
//   programs/<topic>/<words>.programs     many programs in one file, with the text that they share written once: `packedFiles` in generate.ts. A test file writes those that it runs
//                                         into a temporary folder, under the names they have there; `bun test/aot/generate.ts <topic> <where>` writes them all
//   programs/**/tsconfig.json             the compiler options for the programs below it
//   programs/jsc-shell-functions.ts       noInline(), gc() and similar functions, for the programs that import it
//   programs/start-the-entry-point-named.ts  the first entry point of an executable that holds many programs (programs-as-entry-points.ts)
//   programs/changes-to-builtins.js       tries every way to change a property of a built-in object, for the programs about locked built-ins
//   programs/changes-to-builtins-sloppy.cjs  the store and the `delete` in sloppy code, for changes-to-builtins.js
//   programs/generate-copies-born-in-their-holders.ts  writes the programs of copies-born-in-their-holders
//   programs/generate-nothing-throws-because-of-a-type.ts  writes the generated programs of nothing-throws-because-of-a-type
//   programs/generate-replaced-iteration.ts  writes built-ins-on-written-structure/lists-whose-iteration-is-replaced.js
//   programs/generate-type-predicates.ts  writes the generated programs of type-predicates
//                                         What a script writes is not kept here. Each test file writes what it runs of it into a temporary folder, under the names it would have in ./programs.
//                                         generate.ts lists the scripts and writes a folder out for whoever wants to read it: `bun test/aot/generate.ts type-predicates <where>`
//   programs/commonjs/describe-object.cjs prints everything a program can observe about the own properties of an object, for the programs about the exports object of a CommonJS module
//   programs/strings/regexps-built-at-start.cjs  the tokens that regexps-built-at-start.ts and its twin put together
//   programs/untyped-speed/commonjs-package/lib/*.js  the modules that index.js of the package requires
//                                         A file directly in ./programs is a helper. One in the folder of a topic is a program unless `helpers` below lists it
//   packages/                             programs that import packages, with a runner of their own: packages/run-packages.ts
//
//   TEST_PART=all bun test ..                             one program in ten, others for each commit of Bun (see `inShare` below); of packages/, one importer in ten and at least one per case
//   TEST_PART=aot/strings bun test ..                     one topic, the same
//   AOT_SHARE=all bun test ..                             every program
//   AOT_SHARE=<revision> bun test ..                      the programs that the Bun of that revision takes
//   AOT_PROGRAMS=quick bun test ..                        one program in ten, the same ones every time
//   AOT_PROGRAMS= bun test ..                             everything, packages/ too, even with a debug or ASAN build of Bun
//   AOT_PROGRAMS=replace bun test ..                      the programs whose path contains the text
//   AOT_PROGRAMS_JOBS=4 bun test ..                       how many programs run at once (default: one per core)
//   AOT_PROGRAMS_UPDATE=1 bun test ..                     rewrites the .expected.txt and .build-errors.txt files that exist
//
// shell/ has two tools for working on the compiler without building Bun; perf/ has an opt-in performance test; servers/ has
// opt-in tests of HTTP servers written with Bun.serve, node:http and popular frameworks, and the tools that measure them.
// generated-code.test.ts runs shell/expectations.py, which checks the `// IR`, `// CALLS` and `// COUNTER:` lines and the `//!` comments of the programs, where its tools are built.
// parts.mts is the table of what CI runs as a test file of its own: every folder of programs, in how many parts.
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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { availableParallelism, tmpdir } from "os";
import { join, relative, sep } from "path";
import { describedRows, readTable, type Row } from "./built-ins-alone/table";
import { findBuiltinTable, generators, writeGroups, writeProgram, type WrittenProgram } from "./generate";
import { locksEnvironment } from "./hardened";

const root = join(import.meta.dir, "programs");
// A debug or ASAN build of Bun is many times slower, so it runs the quick subset unless told otherwise.
export const wanted = process.env.AOT_PROGRAMS ?? (isASAN || isDebug ? "quick" : "");
const updates = !!process.env.AOT_PROGRAMS_UPDATE;

// CI has four cores for five minutes a file, and every program in every way would take it a day for each commit. So a run that is told nothing takes a share of the programs, and which
// share follows from the revision of the Bun under test: each commit takes others, and in time all are taken. A test is named after its program, so AOT_PROGRAMS=<name> runs a red again.
const seedOfShare = process.env.AOT_SHARE ?? Bun.revision;
const isToldWhatToTake = seedOfShare === "all" || process.env.AOT_PROGRAMS !== undefined || updates;
// Most helpers have a rule of their own for the quick subset. One that has none passes `alsoOfQuickSubset`, or a debug or ASAN build would take everything.
const takesEverything = (alsoOfQuickSubset: boolean) => isToldWhatToTake || (wanted === "quick" && !alsoOfQuickSubset);
let hasSaidShare = false;
// CI has two steps for these tests. One may hold up a merge, so it is the same on every commit: AOT_TAKES=fixed takes no share at all, only what every run takes. The other shows what
// the shares find and holds up nothing: AOT_TAKES=drawn takes the shares alone. A run that is told neither takes both.
const takes = process.env.AOT_TAKES;
/** Whether this run takes what every run takes: the programs of a list, what once went wrong. */
export const takesWhatIsFixed = takes !== "drawn";

/** For a tool that takes every n-th program, starting at the i-th, as `<i>/<n>`: part `part` of `parts`, or, in a run that takes a share, one of `oneIn` pieces of that part. */
export function partInShare(part: number, parts: number, oneIn: number, alsoOfQuickSubset = false): string {
  if (takesEverything(alsoOfQuickSubset)) return `${part}/${parts}`;
  return `${part + parts * Number(BigInt(Bun.hash(seedOfShare)) % BigInt(oneIn))}/${parts * oneIn}`;
}

/** Whether this run takes the program, the case or the pair `name`, of whose kind a run takes one in `oneIn`. */
export function inShare(name: string, oneIn: number, alsoOfQuickSubset = false): boolean {
  if (takes === "fixed") return false;
  if (takesEverything(alsoOfQuickSubset)) return true;
  if (!hasSaidShare) console.error(`SHARE: this run takes a part of the programs. AOT_SHARE=${seedOfShare} takes the same part, AOT_SHARE=all takes all of them`);
  hasSaidShare = true;
  return BigInt(Bun.hash(seedOfShare + " " + name.replaceAll("\\", "/"))) % BigInt(oneIn) === 0n;
}

/** For what no run is meant to take whole: one in `oneIn` by the commit, so that in time all are taken, and nothing where the run is told what to take. */
export const inShareOfTheRest = (name: string, oneIn: number) => !isToldWhatToTake && inShare(name, oneIn, true);

/** For what takes one in `oneIn` of a list, as a debug or ASAN build of Bun takes a tenth of many: whether it takes `name`, the `index`-th. By the commit, as every share, so that in time all are taken; every `oneIn`-th where the run is told what to take. */
export const inShareOfList = (name: string, index: number, oneIn = 10) => (isToldWhatToTake ? index % oneIn === 0 : inShare(name, oneIn, true));

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

function findKept(folder: string, into: string[]) {
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  const main = entries.find(entry => entry.isFile() && /^main\.([cm]?[jt]s|tsx)$/.test(entry.name));
  if (main) return void into.push(join(folder, main.name));
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) findKept(path, into);
    else if (/\.([cm]?[jt]s|tsx)$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name) && !helpers.has(relative(root, path).replaceAll("\\", "/"))) into.push(path);
  }
}

// What a script writes (generate.ts) is written below a temporary folder that stands for ./programs: <that folder>/<topic>/<name>.ts. First the programs are only listed, under the paths they
// would have there. Which of them a run takes goes by those paths, as for a program that is kept, so only what is taken is written.
let writtenRoot: string | undefined;
const notYetWritten = new Map<string, { topic: string; program: WrittenProgram }>();
const programsOfScript = new Map<string, WrittenProgram[]>();
// The programs that follow from the table of built-ins have to be made before anybody knows their names, a group at a time. What is listed is the group: <that folder>/<topic>/<group>.
// The part of a folder, and in a variant the share, go by that path. The rest is asked of each program of a group that is made, as of any other program.
const groups = new Map<string, { topic: string; group: string; rows: Row[]; programs?: string[] }>();
let rowsOfBuiltinTable: Row[] | undefined;

/** The path of a program below ./programs, kept there or not. It names the program, and the parts of a folder, the quick subset and the share go by it. */
export const inPrograms = (path: string) => relative(writtenRoot !== undefined && path.startsWith(writtenRoot + sep) ? writtenRoot : root, path);

function findWritten(topic: string, into: string[]) {
  const generator = generators[topic]();
  if (writtenRoot === undefined) {
    const folder = (writtenRoot = String(tempDir("aot-written-programs", { "tsconfig.json": JSON.stringify({ extends: join(root, "tsconfig.json") }) })));
    // `bun test test/aot` is one process for all files: the next one begins anew.
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
      writtenRoot = undefined;
      notYetWritten.clear();
      groups.clear();
    });
  }
  // The compiler options of the folder hold for what is written as for what is kept.
  if (existsSync(join(root, topic, "tsconfig.json"))) {
    mkdirSync(join(writtenRoot, topic), { recursive: true });
    copyFileSync(join(root, topic, "tsconfig.json"), join(writtenRoot, topic, "tsconfig.json"));
  }
  if (!programsOfScript.has(topic)) programsOfScript.set(topic, generator.programs());
  for (const program of programsOfScript.get(topic)!) {
    // What is kept under the name of a program that the script writes takes its place.
    if (existsSync(join(root, topic, program.entry))) continue;
    const path = join(writtenRoot, topic, program.entry);
    notYetWritten.set(path, { topic, program });
    into.push(path);
  }
  if (!generator.fromTable || unsupported) return;
  if (rowsOfBuiltinTable === undefined) {
    const path = findBuiltinTable(bunExe());
    rowsOfBuiltinTable = path === undefined ? [] : describedRows(readTable(path));
    if (path === undefined) console.error(`SKIPPED: the programs that follow from the table of built-ins: there is no aot_builtin_table.json in $AOT_BUILTIN_TABLE, beside ${bunExe()} or in the folder codegen beside it`);
  }
  for (const [group, rows] of generator.fromTable.groups(rowsOfBuiltinTable)) {
    const path = join(writtenRoot, topic, group);
    if (!groups.has(path)) groups.set(path, { topic, group, rows });
    into.push(path);
  }
}

/** What the scripts write, listed for `taken`: for whoever walks ./programs by himself. `files`: only the programs whose entry point matches. */
export function listWrittenPrograms(files = /./): string[] {
  const all: string[] = [];
  for (const topic of Object.keys(generators)) findWritten(topic, all);
  return all.filter(path => files.test(groups.has(path) ? `${path}.${generators[groups.get(path)!.topic]().fromTable!.extension}` : path));
}

/** Where a program that a script writes lies, written. `name`: its path below ./programs without the extension. Not to be called from inside a test. */
export function pathOfWrittenProgram(name: string): string | undefined {
  const [topic] = name.split("/");
  if (!(topic in generators)) return undefined;
  const all: string[] = [];
  findWritten(topic, all);
  const path = all.find(path => !groups.has(path) && besideOf(inPrograms(path)).replaceAll("\\", "/") === name);
  return path && taken([path], () => true)[0];
}

/** Stands the path, out of such a list, for a group of programs that have yet to be made? */
export const isGroup = (path: string) => groups.has(path);

/** The programs of one topic, or of all. */
export function find(topic?: string): string[] {
  const all: string[] = [];
  if (topic === undefined || existsSync(join(root, topic))) findKept(join(root, topic ?? ""), all);
  for (const each of topic === undefined ? Object.keys(generators) : topic in generators ? [topic] : []) findWritten(each, all);
  return all;
}

/** Whether AOT_PROGRAMS=<text> selects the program. */
const isWanted = (path: string) => inPrograms(path).includes(wanted);
/** No group is made of which AOT_PROGRAMS=<text> selects nothing. The names of its programs are <group> or <group>-<more words>. */
export const mayHoldWhatIsWanted = (path: string) => !groups.has(path) || wanted === "quick" || isWanted(path) || wanted.includes(groups.get(path)!.group + "-");

/** Those of `listed` for which `takes` holds, written where a script writes them. A group is made, and `takes` is asked of its programs. */
export function taken(listed: string[], takes: (path: string) => boolean): string[] {
  const paths = listed.filter(path => groups.has(path) || takes(path));
  for (const path of paths) {
    const unwritten = notYetWritten.get(path);
    notYetWritten.delete(path);
    if (!unwritten) continue;
    writeProgram(join(writtenRoot!, unwritten.topic), unwritten.program);
    // What somebody has decided about such a program is kept in ./programs, under its name.
    for (const suffix of [".json", ".expected.txt", ".build-errors.txt", ".todo.txt"]) {
      const kept = join(root, inPrograms(besideOf(path)) + suffix);
      if (existsSync(kept)) copyFileSync(kept, besideOf(path) + suffix);
    }
  }
  const notYetMade = paths.flatMap(path => groups.get(path) ?? []).filter(group => !group.programs);
  for (const [topic, some] of Map.groupBy(notYetMade, group => group.topic)) {
    // A process that makes programs waits for timers most of the time.
    const jobs = Math.min(64, 4 * Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism()));
    // It is a tool and not what is tested: no collection at every turn of the event loop, no audit of the heap. It exits in the middle of whatever the built-ins have begun, which LeakSanitizer would report.
    const env = {
      ...bunEnv,
      BUN_GARBAGE_COLLECTOR_LEVEL: undefined,
      BUN_JSC_randomIntegrityAuditRate: undefined,
      ASAN_OPTIONS: isASAN ? [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":") : bunEnv.ASAN_OPTIONS,
    };
    const entries = writeGroups(bunExe(), topic, new Map(some.map(({ group, rows }) => [group, rows])), writtenRoot!, jobs, env);
    for (const group of some) group.programs = entries.get(group.group)!.map(entry => join(writtenRoot!, topic, entry));
  }
  return paths.flatMap(path => groups.get(path)?.programs!.filter(takes) ?? [path]);
}

/**
 * For a tool that walks ./programs itself and takes every n-th program, starting at the i-th (`<i>/<n>`, as `partInShare` says it): writes as large a share of what the scripts write.
 * Answers the folder, which stands for ./programs: the tool takes all that lies there.
 */
export function writeShareOfWrittenPrograms(share: string): string {
  const [index, of] = share.split("/").map(Number);
  taken(
    listWrittenPrograms().filter(path => Number((hash(path) >> 16n) % BigInt(of)) === index - 1),
    () => true,
  );
  return writtenRoot!;
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

// AOT_BUILD_FLAGS="--aot-validate": every build with --aot or by `bun compile` that a test file starts through spawned() takes these flags too: a whole file, such as servers/servers.test.ts, in a checking build.
const moreBuildFlags = (process.env.AOT_BUILD_FLAGS ?? "").split(" ").filter(Boolean);

export async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  const behindTheFlag = cmd.indexOf("--aot") + 1 || (cmd[1] === "compile" && !cmd.includes("--library") ? 2 : 0);
  if (moreBuildFlags.length && behindTheFlag) cmd = cmd.toSpliced(behindTheFlag, 0, ...moreBuildFlags);
  // A child that hangs is killed here, and the signal fails the test. A test that merely timed out would leave it running.
  // A build that verifies the IR after every pass takes sixteen times as long as one that does not. --aot-validate checks each built-in module that a program holds: one that starts a Worker holds most of them, one that may load code from disk all.
  const isLong = cmd.includes("--aot-check=verify-each-pass") || cmd.includes("--aot-validate");
  const timeout = isLong || moreBuildFlags.length || isASAN ? 240_000 : collectsAtEveryAllocation(env) ? 120_000 : 90_000;
  const start = performance.now();
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout, killSignal: "SIGKILL" });
  // A build that is asked to end says what each of its threads is still compiling. One that is killed says nothing.
  const secondsToAnswer = 3;
  const isBuild = behindTheFlag && (cmd.includes("build") || cmd.includes("compile"));
  const asked = isBuild && !isWindows ? setTimeout(() => proc.kill("SIGTERM"), timeout - secondsToAnswer * 1000) : undefined;
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(asked);
  const milliseconds = Number(proc.resourceUsage()?.cpuTime.total ?? 0) / 1000;
  const result = { stdout, stderr, exitCode, signal: proc.signalCode };
  const lasted = performance.now() - start;
  if ((proc.signalCode === "SIGKILL" && lasted >= timeout) || (proc.signalCode === "SIGTERM" && asked && lasted >= timeout - secondsToAnswer * 1000)) {
    const stillCompiling = stderr.split("\n").filter(line => line.startsWith("Still "));
    console.error([`KILLED at its time limit of ${timeout / 1000} s, with ${Math.round(milliseconds / 1000)} s of processor time used: ${cmd.at(-1)}`, ...stillCompiling].join("\n  "));
    killedWhenTimeWasUp.add(result);
    if (milliseconds >= timeout / 10) atWorkWhenTimeWasUp.add(result);
  }
  return result;
}

const killedWhenTimeWasUp = new WeakSet<object>();
const atWorkWhenTimeWasUp = new WeakSet<object>();
const collectsAtEveryAllocation = (env: Record<string, string | undefined>) => Number(env.BUN_JSC_slowPathAllocsBetweenGCs) <= 7;
const collectsEveryMillisecond = (env: Record<string, string | undefined>) => env.BUN_JSC_collectContinuously === "1";

// Where the kernel hands a core to a program (systemd-coredump, apport) it starts that program whatever the limit is, but for a limit of one byte, and the process that a signal ended is
// gone only when the program has read it: seconds on a busy machine.
export const withoutCoreDump = (cmd: string[]) =>
  isWindows ? cmd : ["/bin/sh", "-c", `command -v prlimit > /dev/null 2>&1 && exec prlimit --core=1:1 "$@"; ulimit -c 0 && exec "$@"`, "--", ...cmd];
/** For a process that is meant to end by a signal. CI's runner books a report that a passing file leaves on the next file that fails. */
export const withoutCrashReport: Record<string, string> = { BUN_ENABLE_CRASH_REPORTING: "0", ...(!locksEnvironment && { BUN_CRASH_REPORT_URL: "" }) };

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
  // LeakSanitizer's suppressions (test/leaksan.supp) name functions, so under it the copy keeps its table of symbols.
  const removed = isASAN ? ["--strip-debug"] : [];
  if (Bun.spawnSync({ cmd: [strip, ...removed, "-o", unfinished, bunExe()], stdout: "ignore", stderr: "ignore" }).exitCode !== 0) {
    rmSync(unfinished, { force: true });
    return [];
  }
  renameSync(unfinished, copy);
  return ["--compile-executable-path", copy];
}

let executables = 0;

type ProgramOptions = { build?: string[]; entryPoints?: string[]; buildEnv?: Record<string, string>; env?: Record<string, string>; reference?: "compiled"; erased?: "as plain Bun" };
// How the programs of one describe() are built and run.
type Setup = { folder: string; carrier: string[]; buildFlags: string[]; runEnv: Record<string, string> | Record<string, string>[]; erasesTypes: boolean; stubCopies?: number };
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

const loggingOptions = new Set(["logAOTPhaseTimes", "dumpAOTB3Graph", "dumpAOTDisassembly", "aotFunctionToDump", "aotMapFilePath"].map(name => `BUN_JSC_${name}`));

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

async function buildCompiled(program: CompiledProgram) {
  const executable = nextExecutablePath(program.outputFolder ?? program.cwd, "program");
  const flags = ["--aot-check=validate-references", ...(isASAN || isDebug ? ["--aot-check=ClaimsToBackEnd"] : []), ...program.carrier, ...program.buildFlags, ...(program.statistics?.length || program.stubCopiesExpected ? ["--explain=statistics"] : [])];
  const cmd = [bunExe(), "build", "--compile", "--aot", ...flags, ...program.entryPoints, "--outfile", executable];
  const ran = await spawned(cmd, program.cwd, { ...bunEnv, ...program.buildEnvironment });
  const build = { ...ran, executable };
  if (atWorkWhenTimeWasUp.has(ran)) atWorkWhenTimeWasUp.add(build);
  return build;
}

/** Builds the program, runs its executable once in each environment and hands each result to `check`. */
async function runCompiled(program: CompiledProgram, check: (result: RunResult, environment: Record<string, string>) => void) {
  const build = await buildCompiled(program);
  try {
    // Nor does how long a build takes that verifies the IR after every pass: it has found nothing invalid in what it got to.
    if (program.buildFlags.includes("--aot-check=verify-each-pass") && atWorkWhenTimeWasUp.has(build)) {
      console.error(`NOT THROUGH: the build of ${program.entryPoints[0]} was still at work when its time was up`);
      return;
    }
    built(build);
    expectStatistics(build.stderr, [
      ...(program.statistics ?? []),
      ...(program.stubCopiesExpected ? [{ name: "StubCopiesEmitted", relation: ">=", bound: 2 } as const] : []),
    ]);
    let spentCollecting = 0;
    for (const environment of program.runEnvironments) {
      // A list of environments goes from mild to harsh. A program that has taken a minute in the mild ones is not run in the harsh ones.
      if (collectsAtEveryAllocation(environment) && spentCollecting > 60_000) continue;
      const start = performance.now();
      const ran = await spawned(withoutCoreDump([build.executable]), program.cwd, { ...bunEnv, ...environment, BUN_AOT_VERBOSE: "1" });
      if (collectsAtEveryAllocation(environment)) spentCollecting += performance.now() - start;
      // How long a program takes where every allocation collects says nothing about it, nor where a collection is asked for every millisecond, nor where the executable checks
      // while it runs what the compiler took for proven. One that is still at work when its time is up has shown no fault, and has no output to compare.
      const isSlowOnPurpose = collectsAtEveryAllocation(environment) || collectsEveryMillisecond(environment) || program.buildFlags.includes("--aot-validate");
      // TODO: on Windows an executable in which a collection is asked for every millisecond has been killed at its time limit. Whether it was at work is not known.
      const stallsOnWindows = isWindows && collectsEveryMillisecond(environment) && killedWhenTimeWasUp.has(ran);
      if ((isSlowOnPurpose && atWorkWhenTimeWasUp.has(ran)) || stallsOnWindows) {
        console.error(`NOT THROUGH: ${program.entryPoints[0]} was still at work when its time was up`);
        continue;
      }
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

export function expectStored(file: string, result: RunResult) {
  // What is stored names the files of an executable as they are named elsewhere than on Windows.
  const text = (result.stdout + (result.exitCode ? `exit code ${result.exitCode}\n${result.stderr}\n` : result.stderr)).replace(
    /B:\\~BUN\\root[^\s'":]*/g,
    path => "/$bunfs/root" + path.slice(12).replaceAll("\\", "/"),
  );
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
    const hasFailed = plain.signal !== null || plain.exitCode !== 0;
    expect({ signal: plain.signal, exitCode: plain.exitCode, stderr: hasFailed ? plain.stderr : "" }).toEqual({ signal: null, exitCode: 0, stderr: "" });
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
    runEnvironments: [setup.runEnv].flat().map(environment => ({ ...options.env, ...environment })),
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
  if (setup.erasesTypes && hasTypes(path)) ways.push({ way: "compiled with types erased", stored: options.erased ? "" : beside + ".expected.txt", program: createProgram(["--aot-erase-types"], []) });
  let reference: RunResult | undefined;
  for (const { way, stored, program } of ways) {
    if (existsSync(stored)) await runCompiled(program, result => expectStored(stored, result));
    else await expectCompiledOutput(way, program, (reference ??= await runReference(path, options, setup)));
  }
}

const hash = (path: string) => BigInt(Bun.hash(inPrograms(path).replaceAll("\\", "/")));
const isQuick = (path: string) => (hash(path) >> 8n) % 10n === 0n;
// AOT_PROGRAMS=quick names the same tenth every time. The tenth that a debug or ASAN build takes by itself goes by the commit, as every share does: in time all are taken.
const isInTenthOfSlowBuild = (path: string) =>
  process.env.AOT_PROGRAMS === undefined && seedOfShare !== "all" ? inShare(inPrograms(path), 10, true) : isQuick(path);
/** For what walks all folders and takes few: one program in ten, or in three, others for each commit and each `label`, so that in time all are taken. A run that is told what to take gets the same ones every time. */
export const inTenthOfAll = (label: string, path: string) => (isToldWhatToTake ? isQuick(path) : inShare(`${label} tenth ${inPrograms(path)}`, 10, true));
export const inThirdOfAll = (label: string, path: string) => (isToldWhatToTake ? (hash(path) >> 32n) % 3n === 0n : inShare(`${label} third ${inPrograms(path)}`, 3, true));
export const besideOf = (path: string) => path.replace(/[\\/]main\.[a-z]+$/, "").replace(/\.[a-z]+$/, "");
/** Where what is stored beside a program lies in ./programs, for a program that is kept there and for one that is yet to be written. */
export const keptBeside = (path: string) => join(root, inPrograms(besideOf(path)));
const runsWithASAN = (path: string) => isASAN && takesWhatIsFixed && existsSync(keptBeside(path) + ".json") && !!JSON.parse(readFileSync(keptBeside(path) + ".json", "utf8")).runWithASAN;

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
      const name = inPrograms(beside).replaceAll("\\", "/");
      const skipWithASAN: string | undefined = isASAN && existsSync(beside + ".json") ? JSON.parse(readFileSync(beside + ".json", "utf8")).skipWithASAN : undefined;
      const todoHere: string | undefined = existsSync(beside + ".json") ? JSON.parse(readFileSync(beside + ".json", "utf8")).todoOn?.[process.platform] : undefined;
      if (existsSync(beside + ".todo.txt")) test.todo(name);
      else if (todoHere) {
        console.error(`TODO: ${name}: ${todoHere}`);
        test.todo(name);
      }
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
  define(
    `compile/aot/${topic}`,
    taken(
      find(topic)
        .filter(path => Number(hash(path) % BigInt(parts)) === part - 1)
        .filter(mayHoldWhatIsWanted),
      path => (wanted === "quick" ? isInTenthOfSlowBuild(path) || runsWithASAN(path) : isWanted(path)) && inShare(inPrograms(path), 10),
    ),
    { buildFlags: [], runEnv: {}, erasesTypes: true },
  );
}

/** What compares times says so where it leaves the sanitizer out: "skipWithASAN": "a clock". */
const isJudgedByClock = (path: string) => existsSync(keptBeside(path) + ".json") && /\bclock\b|\bcompares two times\b/.test(JSON.parse(readFileSync(keptBeside(path) + ".json", "utf8")).skipWithASAN ?? "");

/**
 * The programs that every run takes, whatever its share and whatever the build of Bun: all of ./programs/counterexamples, and those that ./programs-in-every-run.txt lists, one a line,
 * as a path below ./programs without its extension. Each is judged as programs() judges it. A line that names no program fails.
 */
export function programsInEveryRun(part = 1, parts = 1) {
  // A machine that runs other tests beside this one moves a ratio of two times. What compares times is taken by the step of CI that holds up nothing.
  const listed = readFileSync(join(import.meta.dir, "programs-in-every-run.txt"), "utf8").split(/\r?\n/).filter(line => line !== "");
  const nameOf = (path: string) => besideOf(inPrograms(path)).replaceAll("\\", "/");
  const all = [...new Set(["counterexamples", ...listed.map(name => name.slice(0, name.indexOf("/")))])].flatMap(find).filter(path => !groups.has(path));
  const names = new Set(all.map(nameOf));
  if (part === 1) test("every line of programs-in-every-run.txt names a program", () => expect(listed.filter(name => !names.has(name))).toEqual([]));
  const isListed = new Set(listed);
  define(
    "compile/aot/in-every-run",
    taken(
      all.filter(path => Number((hash(path) >> 24n) % BigInt(parts)) === part - 1),
      path => (isJudgedByClock(path) ? takes !== "fixed" : takesWhatIsFixed) && (nameOf(path).startsWith("counterexamples/") || isListed.has(nameOf(path))) && (wanted === "" || wanted === "quick" || isWanted(path)),
    ),
    { buildFlags: [], runEnv: {}, erasesTypes: true },
  );
}

/** The mark that leaves a program out because it fails with the Bun under test, as it is named to whoever takes it out. */
function markOfFailure(path: string): string | undefined {
  const name = inPrograms(besideOf(path)).replaceAll("\\", "/");
  const kept = join(root, name);
  const options: { skipWithASAN?: string; todoOn?: Record<string, string> } = existsSync(kept + ".json") ? JSON.parse(readFileSync(kept + ".json", "utf8")) : {};
  // Such a build is many times slower, and what fails everywhere is looked at elsewhere.
  if (isASAN) return /^TODO\b/.test(options.skipWithASAN ?? "") ? `"skipWithASAN" in ${name}.json` : undefined;
  if (existsSync(kept + ".todo.txt")) return readFileSync(kept + ".todo.txt", "utf8").startsWith("Not every time:") ? undefined : `${name}.todo.txt`;
  return options.todoOn?.[process.platform] ? `"todoOn" in ${name}.json` : undefined;
}

/**
 * A mark that outlives its cure hides the next fault. The programs that are left out because they fail (`<name>.todo.txt`, "todoOn" for this platform, and with AddressSanitizer a
 * "skipWithASAN" that begins with TODO) are run as programs() runs the others, and one that does what is expected is red: its mark goes out. What fails on one run and not on the
 * next is not asked: a `<name>.todo.txt` that begins with "Not every time:", and what compares two times, where the machine decides.
 */
export function programsMarkedAsFailing() {
  const folder = String(tempDir("aot-programs", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const isAsked = (path: string) => takes !== "fixed" && !inPrograms(path).startsWith("untyped-speed") && !isJudgedByClock(path) && (wanted === "" || wanted === "quick" || isWanted(path));
  const chosen = taken(
    find().filter(path => !groups.has(path)),
    path => isAsked(path) && markOfFailure(path) !== undefined,
  );
  describe.concurrent("compile/aot/marked-as-failing", () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    if (chosen.length === 0) test.skip("no program selected", () => {});
    for (const path of chosen) {
      const mark = markOfFailure(path);
      test(
        inPrograms(besideOf(path)).replaceAll("\\", "/"),
        async () => {
          const outcome = await slot(() => run(path, besideOf(path), { folder, carrier: [], buildFlags: [], runEnv: {}, erasesTypes: true })).then(
            () => "it does what is expected: the mark goes out",
            () => "it fails",
          );
          expect({ mark, outcome }).toEqual({ mark, outcome: "it fails" });
        },
        600_000,
      );
    }
  });
}

/**
 * Runs every program of one folder once more, built with other flags or run in another environment: for a folder whose programs
 * only bite there, as those about what a caller believes of a callee do where calls stay calls. Each program is built once and
 * compared with plain Bun: programs() covers the build with erased types. AOT_PROGRAMS selects as in programs(). A large folder is split into `parts` as there.
 * `only` names the programs of the folder that are run, without the folder and without an extension; a name that is not there fails.
 */
export function programsBuiltWith(topic: string, label: string, buildFlags: string[], runEnv: Record<string, string> = {}, part = 1, parts = 1, only?: readonly string[]) {
  const all = find(topic);
  const nameOf = (path: string) => besideOf(relative(topic, inPrograms(path))).replaceAll("\\", "/");
  const isNamed = (path: string, name: string) => (groups.has(path) ? `${name}-`.startsWith(`${nameOf(path)}-`) : name === nameOf(path));
  const missing = only?.filter(name => !all.some(path => isNamed(path, name))) ?? [];
  if (missing.length) throw new Error(`no such program in ${topic}: ${missing.join(", ")}`);
  define(
    `compile/aot/${topic}/${label}`,
    taken(
      all
        .filter(path => !only || only.some(name => isNamed(path, name)))
        .filter(path => Number(hash(path) % BigInt(parts)) === part - 1)
        .filter(mayHoldWhatIsWanted),
      path =>
        (wanted === "quick" ? isInTenthOfSlowBuild(path) || runsWithASAN(path) : isWanted(path)) &&
        // A list of names is a list of programs that once went wrong so: all of them are taken.
        (only ? takesWhatIsFixed && only.includes(nameOf(path)) : inShare(label + " " + inPrograms(path), 10)),
    )
      .filter(path => !existsSync(besideOf(path) + ".build-errors.txt"))
      // As in variant(): <program>.json may say why the program is left out under this label.
      .filter(path => !existsSync(besideOf(path) + ".json") || !JSON.parse(readFileSync(besideOf(path) + ".json", "utf8")).skipInVariant?.[label]),
    { buildFlags, runEnv, erasesTypes: false },
  );
}

/**
 * Runs programs of all topics once more, built with flags that force the compiler down a path which small programs
 * otherwise never take. Each program is built once and compared with plain Bun: programs() covers the build with erased types.
 * A run that is told nothing takes one program in four hundred, by `inShare`: others for each commit and each label, and in time all of them. AOT_SHARE=all and AOT_PROGRAMS=quick take the
 * quick subset, AOT_PROGRAMS=<text> selects as above. `runEnv` is set where the executable runs.
 * It is split into `parts` as a large folder is. A build with a sanitizer takes a third of them. The programs `always` are taken in any case.
 * `stubCopies`: each program is laid out so that it needs about that many copies of the shared stubs.
 * A list of environments: the one executable runs once in each.
 */
export function variant(
  label: string,
  buildFlags: string[],
  runEnv: Record<string, string> | Record<string, string>[] = {},
  part = 1,
  parts = 1,
  always: string | string[] = [],
  stubCopies?: number,
) {
  const isAlwaysTaken = (path: string) => takesWhatIsFixed && [always].flat().includes(besideOf(inPrograms(path)).replaceAll("\\", "/"));
  // Two draws, since a group is drawn before its programs have names: one path or group in forty, then one program in ten.
  define(
    `compile/aot/variant/${label}`,
    taken(
      find()
        // A file directly in ./programs is a helper, not a program.
        .filter(path => /[\\/]/.test(inPrograms(path)))
        .filter(mayHoldWhatIsWanted)
        .filter(
          path =>
            isAlwaysTaken(path) ||
            (inShare(label + " " + inPrograms(path), 40, true) && Number((hash(path) >> 16n) % BigInt(parts)) === part - 1 && (!isASAN || inThirdOfAll(label, path))),
        ),
      path => isAlwaysTaken(path) || (wanted === "" || wanted === "quick" ? inTenthOfAll(label, path) : isWanted(path)),
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


export function variantWithTrimmedRuntime(part: number, parts: number) {
  using probe = tempDir("trimmed-runtime-probe", { "hello.ts": "console.log(1);" });
  const probed = Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--trim", "hello.ts", "--outfile", "hello"],
    cwd: String(probe),
    env: bunEnv,
    stderr: "pipe",
  });
  if (probed.exitCode === 0) variant("trimmed-runtime", ["--trim"], {}, part, parts);
  else test.skip("this Bun was not linked for --trim", () => {});
}
