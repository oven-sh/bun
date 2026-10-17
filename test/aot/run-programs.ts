// Builds every program under ./programs with `bun build --compile --aot`, runs the executable, and compares its output with
// what plain `bun run` prints for the same file, computed on the spot. Nothing is stored for a program that behaves the same
// in both. Each <topic>.test.ts next to this file runs one folder of programs, or one part of a large folder; each
// variant-<name>.test.ts runs the quick subset again with an option that changes how the compiler lays out its code.
//
//   programs/<topic>/<name>.ts            a program in a single file (.ts, .tsx or .js); its first line says what it tests
//   programs/<topic>/<name>/main.ts       a program that consists of several files
//   <program>.expected.txt                the output under --aot where it is meant to differ from plain Bun, for example
//                                         because a value that does not match its declared type throws a TypeError
//   <program>.build-errors.txt            the build must fail with exit code 1 and exactly these `error:` lines; an
//                                         .expected.txt next to it is only used by shell/quick.py, which still runs the program
//   <program>.todo.txt                    the program fails today, and why; it is listed as a todo and not run
//   <program>.json                        { "build": [flags for `bun build`], "env": { .. }, "reference": "compiled" }
//                                         "compiled": compare with `bun build --compile` without --aot, for features that
//                                         only the bundler provides (--define, --feature, files imported as text)
//                                         "skipInShell": why shell/quick.py skips the program; not read here
//                                         "skipWithASAN": why a Bun built with AddressSanitizer skips the program
//   programs/**/tsconfig.json             the compiler options for the programs below it
//   programs/jsc-shell-functions.ts       noInline(), gc() and similar functions, for the programs that import it
//   packages/, packages-<topic>.test.ts   programs that import packages, with a runner of their own: packages/run-packages.ts
//
//   bun test test/aot                                     every program; of packages/, one importer in ten and at least one per case
//   bun test test/aot/strings                             one topic
//   AOT_PROGRAMS=quick bun test test/aot                  one program in ten, the same ones every time
//   AOT_PROGRAMS= bun test test/aot                       everything, packages/ too, even with a debug or ASAN build of Bun
//   AOT_PROGRAMS=replace bun test test/aot/strings        the programs whose path contains the text
//   AOT_PROGRAMS_JOBS=4 bun test ..                       how many programs run at once (default: one per core)
//   AOT_PROGRAMS_UPDATE=1 bun test ..                     rewrites the .expected.txt and .build-errors.txt files
//
// shell/ has two tools for working on the compiler without building Bun; perf/ has an opt-in performance test; servers/ has
// opt-in tests of HTTP servers written with Bun.serve, node:http and popular frameworks, and the tools that measure them.
// generated-code.test.ts runs shell/expectations.py, which checks the `// IR` and `// CALLS` lines of the programs, where its two tools are built.
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
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { availableParallelism, tmpdir } from "os";
import { join, relative } from "path";

const root = join(import.meta.dir, "programs");
// A debug or ASAN build of Bun is many times slower, so it runs the quick subset unless told otherwise.
export const wanted = process.env.AOT_PROGRAMS ?? (isASAN || isDebug ? "quick" : "");
const updates = !!process.env.AOT_PROGRAMS_UPDATE;

// Not every build of Bun includes the compiler. One that lacks it says so before it looks for the entry point.
export const unsupported = /^error: --aot: (.*)$/m.exec(
  Bun.spawnSync({ cmd: [bunExe(), "build", "--compile", "--aot", "./no-such-file.ts"], cwd: root, env: bunEnv, stdout: "ignore", stderr: "pipe" }).stderr.toString(),
)?.[1];
if (unsupported) console.error(`SKIPPED: the tests of --aot in this file: ${unsupported}`);

function find(folder: string, into: string[]) {
  const entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  const main = entries.find(entry => entry.isFile() && /^main\.(ts|tsx|js)$/.test(entry.name));
  if (main) return void into.push(join(folder, main.name));
  for (const entry of entries) {
    if (entry.isDirectory()) find(join(folder, entry.name), into);
    else if (/\.(ts|tsx|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) into.push(join(folder, entry.name));
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
    // between an executable and the sources.
    stderr: run.exitCode === 0 ? run.stderr : (run.stderr.split("\n").find(line => /^(error|[A-Za-z]*Error)\b/.test(line)) ?? ""),
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

async function run(path: string, beside: string, folder: string, carrier: string[], buildEnv: Record<string, string>, runEnv: Record<string, string>) {
  const options: { build?: string[]; env?: Record<string, string>; reference?: "compiled"; skipInShell?: string } = existsSync(beside + ".json")
    ? JSON.parse(readFileSync(beside + ".json", "utf8"))
    : {};
  const flags = options.build ?? [];
  const env = { ...bunEnv, ...options.env };
  const cwd = join(path, "..");
  const executable = join(folder, `program-${executables++}${isWindows ? ".exe" : ""}`);
  try {
    const build = await spawned([bunExe(), "build", "--compile", "--aot", ...carrier, ...flags, path, "--outfile", executable], cwd, { ...bunEnv, ...buildEnv });
    if (existsSync(beside + ".build-errors.txt")) {
      // Each distinct error counts once; how often it is repeated for different positions is not what is tested.
      const errors = [...new Set(build.stderr.split("\n").filter(line => line.startsWith("error: ")))].join("\n") + "\n";
      if (updates) writeFileSync(beside + ".build-errors.txt", errors);
      expect({ errors, exitCode: build.exitCode }).toEqual({ errors: readFileSync(beside + ".build-errors.txt", "utf8"), exitCode: 1 });
      return;
    }
    built(build);

    const ran = await spawned([executable], cwd, { ...env, ...runEnv, BUN_AOT_VERBOSE: "1" });
    expect({ signal: ran.signal, stderr: ran.signal ? ran.stderr : "" }).toEqual({ signal: null, stderr: "" });
    // The executable really ran compiled code and did not fall back to the embedded source.
    expect(ran.stderr).toContain("[aot] module: ");
    const compiled = told({ ...ran, stderr: ran.stderr.replace(/^\[aot\] .*\n/gm, "") });

    if (existsSync(beside + ".expected.txt")) {
      const text = compiled.stdout + (compiled.exitCode ? `exit code ${compiled.exitCode}\n${compiled.stderr}\n` : compiled.stderr);
      if (updates) writeFileSync(beside + ".expected.txt", text);
      expect(text).toBe(readFileSync(beside + ".expected.txt", "utf8"));
      return;
    }
    if (options.reference === "compiled") built(await spawned([bunExe(), "build", "--compile", ...carrier, ...flags, path, "--outfile", executable], cwd, bunEnv));
    const plain = await spawned(options.reference === "compiled" ? [executable] : [bunExe(), "run", path], cwd, env);
    // A reference run that fails is useless: two runs that end with the same error would compare equal and prove nothing.
    expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
    expect(compiled).toEqual(told(plain));
  } finally {
    rmSync(executable, { force: true });
  }
}

const hash = (path: string) => BigInt(Bun.hash(relative(root, path).replaceAll("\\", "/")));
const isQuick = (path: string) => (hash(path) >> 8n) % 10n === 0n;
const besideOf = (path: string) => path.replace(/[\\/]main\.[a-z]+$/, "").replace(/\.[a-z]+$/, "");

function define(title: string, chosen: string[], buildEnv: Record<string, string>, runEnv: Record<string, string> = {}) {
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
      else test(name, () => slot(() => run(path, beside, folder, carrier, buildEnv, runEnv)), 600_000);
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
      .filter(path => (wanted === "quick" ? isQuick(path) : relative(root, path).includes(wanted))),
    {},
  );
}

/**
 * Runs the quick subset of all topics once more, built with a JavaScriptCore option that forces the compiler down a path which
 * small programs otherwise never take. AOT_PROGRAMS=<text> selects other programs, as above. `runEnv` is set where the executable runs.
 * It is split into `parts` as a large folder is. A build with a sanitizer takes a third of them.
 */
export function variant(label: string, buildEnv: Record<string, string>, runEnv: Record<string, string> = {}, part = 1, parts = 1) {
  const all: string[] = [];
  find(root, all);
  define(
    `compile/aot/variant/${label}`,
    all
      // A file directly in ./programs is a helper, not a program.
      .filter(path => /[\\/]/.test(relative(root, path)))
      .filter(path => (wanted === "" || wanted === "quick" ? isQuick(path) : relative(root, path).includes(wanted)))
      .filter(path => Number((hash(path) >> 16n) % BigInt(parts)) === part - 1)
      .filter(path => !isASAN || (hash(path) >> 32n) % 3n === 0n)
      // Nothing is compiled for a program that the build rejects.
      .filter(path => !existsSync(besideOf(path) + ".build-errors.txt") && !existsSync(besideOf(path) + ".todo.txt")),
    buildEnv,
    runEnv,
  );
}
