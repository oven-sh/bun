// Builds every program under ./programs with `bun build --compile --aot`, runs the executable, and compares its output with
// what plain `bun run` prints for the same file, computed on the spot. Nothing is stored for a program that behaves the same
// in both. Each <topic>.test.ts next to this file runs one folder of programs, or one part of a large folder.
//
//   programs/<topic>/<name>.ts            a program in a single file (.ts, .tsx or .js); its first line says what it tests
//   programs/<topic>/<name>/main.ts       a program that consists of several files
//   <program>.expected.txt                the output under --aot where it is meant to differ from plain Bun, for example
//                                         because a value that does not match its declared type throws a TypeError
//   <program>.build-errors.txt            the build must fail with exit code 1 and exactly these `error:` lines
//   <program>.todo.txt                    the program fails today, and why; it is listed as a todo and not run
//   <program>.json                        { "build": [flags for `bun build`], "env": { .. }, "reference": "compiled" }
//                                         "compiled": compare with `bun build --compile` without --aot, for features that
//                                         only the bundler provides (--define, --feature, files imported as text)
//                                         "skipInShell": why shell/quick.py skips the program; not read here
//   programs/**/tsconfig.json             the compiler options for the programs below it
//   programs/jsc-shell-functions.ts       noInline(), gc() and similar functions, for the programs that import it
//
//   bun test test/aot                                     everything
//   bun test test/aot/strings                             one topic
//   AOT_PROGRAMS=quick bun test test/aot                  one program in ten, the same ones every time
//   AOT_PROGRAMS= bun test test/aot                       everything, even with a debug or ASAN build of Bun
//   AOT_PROGRAMS=replace bun test test/aot/strings        the programs whose path contains the text
//   AOT_PROGRAMS_JOBS=4 bun test ..                       how many programs run at once (default: one per core)
//   AOT_PROGRAMS_UPDATE=1 bun test ..                     rewrites the .expected.txt and .build-errors.txt files
//
// shell/ has two tools for working on the compiler without building Bun; perf/ has an opt-in performance test.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { availableParallelism } from "os";
import { join, relative } from "path";

const root = join(import.meta.dir, "programs");
// A debug or ASAN build of Bun is many times slower, so it runs the quick subset unless told otherwise.
const wanted = process.env.AOT_PROGRAMS ?? (isASAN || isDebug ? "quick" : "");
const updates = !!process.env.AOT_PROGRAMS_UPDATE;

// Not every build of Bun includes the compiler. One that lacks it says so before it looks for the entry point.
const unsupported = /^error: --aot: (.*)$/m.exec(
  Bun.spawnSync({ cmd: [bunExe(), "build", "--compile", "--aot", "./no-such-file.ts"], cwd: root, env: bunEnv, stdout: "ignore", stderr: "pipe" }).stderr.toString(),
)?.[1];

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
async function slot<T>(work: () => Promise<T>): Promise<T> {
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

async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  // A child that hangs is killed here, and the signal fails the test. A test that merely timed out would leave it running.
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 90_000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}

/** The parts of a run's result that must be equal between two ways of running a program. */
function told(run: { stdout: string; stderr: string; exitCode: number }) {
  return {
    // A duration that a program measures is not part of its behavior.
    stdout: run.stdout.replace(/ [0-9]+ms$/gm, ""),
    // For an uncaught error, only the line that names the error: the stack frames below it contain file paths, which differ
    // between an executable and the sources.
    stderr: run.exitCode === 0 ? run.stderr : (run.stderr.split("\n").find(line => /^(error|[A-Za-z]*Error)\b/.test(line)) ?? ""),
    exitCode: run.exitCode,
  };
}

function built(build: { stderr: string; exitCode: number }) {
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
}

let executables = 0;

async function run(path: string, beside: string, folder: string) {
  const options: { build?: string[]; env?: Record<string, string>; reference?: "compiled"; skipInShell?: string } = existsSync(beside + ".json")
    ? JSON.parse(readFileSync(beside + ".json", "utf8"))
    : {};
  const flags = options.build ?? [];
  const env = { ...bunEnv, ...options.env };
  const cwd = join(path, "..");
  const executable = join(folder, `program-${executables++}${isWindows ? ".exe" : ""}`);
  try {
    const build = await spawned([bunExe(), "build", "--compile", "--aot", ...flags, path, "--outfile", executable], cwd, bunEnv);
    if (existsSync(beside + ".build-errors.txt")) {
      // Each distinct error counts once; how often it is repeated for different positions is not what is tested.
      const errors = [...new Set(build.stderr.split("\n").filter(line => line.startsWith("error: ")))].join("\n") + "\n";
      if (updates) writeFileSync(beside + ".build-errors.txt", errors);
      expect({ errors, exitCode: build.exitCode }).toEqual({ errors: readFileSync(beside + ".build-errors.txt", "utf8"), exitCode: 1 });
      return;
    }
    built(build);

    const ran = await spawned([executable], cwd, { ...env, BUN_AOT_VERBOSE: "1" });
    expect(ran.signal).toBeNull();
    // The executable really ran compiled code and did not fall back to the embedded source.
    expect(ran.stderr).toContain("[aot] module: ");
    const compiled = told({ ...ran, stderr: ran.stderr.replace(/^\[aot\] .*\n/gm, "") });

    if (existsSync(beside + ".expected.txt")) {
      const text = compiled.stdout + (compiled.exitCode ? `exit code ${compiled.exitCode}\n${compiled.stderr}\n` : compiled.stderr);
      if (updates) writeFileSync(beside + ".expected.txt", text);
      expect(text).toBe(readFileSync(beside + ".expected.txt", "utf8"));
      return;
    }
    if (options.reference === "compiled") built(await spawned([bunExe(), "build", "--compile", ...flags, path, "--outfile", executable], cwd, bunEnv));
    const plain = await spawned(options.reference === "compiled" ? [executable] : [bunExe(), "run", path], cwd, env);
    // A reference run that fails is useless: two runs that end with the same error would compare equal and prove nothing.
    expect({ signal: plain.signal, exitCode: plain.exitCode }).toEqual({ signal: null, exitCode: 0 });
    expect(compiled).toEqual(told(plain));
  } finally {
    rmSync(executable, { force: true });
  }
}

/** Defines one test per program in a folder. A large folder is split into `parts` by a hash of the path. */
export function programs(topic: string, part = 1, parts = 1) {
  const all: string[] = [];
  find(join(root, topic), all);
  const hash = (path: string) => BigInt(Bun.hash(relative(root, path).replaceAll("\\", "/")));
  const chosen = all
    .filter(path => Number(hash(path) % BigInt(parts)) === part - 1)
    .filter(path => (wanted === "quick" ? (hash(path) >> 8n) % 10n === 0n : relative(root, path).includes(wanted)));
  const folder = String(tempDir("aot-programs", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  describe.concurrent(`compile/aot/${topic}`, () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    // A filter can leave a test file without any program.
    if (chosen.length === 0) test.skip("no program selected", () => {});
    for (const path of chosen) {
      const beside = path.replace(/[\\/]main\.[a-z]+$/, "").replace(/\.[a-z]+$/, "");
      const name = relative(root, beside).replaceAll("\\", "/");
      if (existsSync(beside + ".todo.txt")) test.todo(name);
      // The child processes have their own time limits; this one also covers the wait for a free slot.
      else test(name, () => slot(() => run(path, beside, folder)), 600_000);
    }
  });
}
