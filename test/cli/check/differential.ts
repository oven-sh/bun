import { afterEach, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir as temporaryDirectory } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { endChildren, longLimit, spawn } from "../children";

// `bun check` follows TypeScript 7, a native executable that ships next to its `lib.*.d.ts` files. It's `typescript7`
// in test/package.json, alongside the `typescript` package with the JavaScript API. Set `TSC` to compare with another
// executable.
function nativeTypeScript() {
  if (process.env.TSC) return process.env.TSC;
  try {
    const paths = [dirname(require.resolve("typescript7/package.json"))];
    const name = `@typescript/typescript-${process.platform}-${process.arch}`;
    return join(dirname(require.resolve(`${name}/package.json`, { paths })), "lib", isWindows ? "tsc.exe" : "tsc");
  } catch {
    // No native package for this platform.
  }
}
export const tsc = nativeTypeScript();

export const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

// tsc is a Go program, and its garbage collector takes about half the CPU time of a small check, because it runs on
// every core. Here it collects on one thread, and only above 1 GiB. What tsc prints doesn't change.
const oracle = { ...env, GOMAXPROCS: "1", GOGC: "off", GOMEMLIMIT: "1GiB" };

// A check keeps a core busy from start to end. Running more of them than there are cores finishes none of them sooner,
// and each holds its memory for longer.
const width = availableParallelism();
let running = 0;
const waiting: (() => void)[] = [];
// How many times `endChecks` has ended the tests that the checks were for.
let ended = 0;
// The children that are running, and the directories of the tests, for `endChecks`.
const exits = new Set<Promise<unknown>>();
const directories: Disposable[] = [];

/**
 * Returns what `cmd` prints and how it exited. It starts once fewer than `width` others are running, whichever tests
 * they belong to.
 */
export async function outputOf(cmd: string[], cwd: string) {
  const before = ended;
  if (running < width) running++;
  // The one that exits hands its slot to the one that has waited longest.
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    await using proc = spawn({
      timeout: longLimit,
      cmd,
      cwd,
      env: cmd[0] === tsc ? oracle : env,
      stdout: "pipe",
      stderr: "ignore",
    });
    const exited = proc.exited;
    exits.add(exited);
    void exited.then(() => exits.delete(exited));
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), exited]);
    // `endChecks` killed it. Its test is over, so the test's code must not continue from here.
    if (before !== ended) return new Promise<never>(() => {});
    return { stdout, exitCode, signalCode: proc.signalCode };
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

/**
 * `endChildren`, for tests that are over. A test that timed out keeps running: its checks that wait for a slot would
 * start when the children exit, and the code after them would start more. So its code stops at its checks and never
 * reaches the end of a `using`, and this removes its directories once the children are gone.
 */
export async function endChecks() {
  ended++;
  waiting.length = 0;
  endChildren();
  await Promise.all(exits);
  for (const directory of directories.splice(0)) directory[Symbol.dispose]();
}

/** `tempDir` of the harness. `endChecks` removes the directory too, for a test that it stopped before the end. */
export const tempDir: typeof temporaryDirectory = (...args) => {
  const directory = temporaryDirectory(...args);
  directories.push(directory);
  return directory;
};

/**
 * Returns the lines of `output`, with `root` stripped from paths. A crash prints nothing, so it adds a line with the
 * exit status.
 */
function linesIn({ stdout, exitCode, signalCode }: Awaited<ReturnType<typeof outputOf>>, cmd: string[], root: string) {
  // bun crashes with a signal, or with exit code 3 on Windows. tsc exits with 4 if project references form a cycle.
  const hasCrashed = signalCode !== null || exitCode > (cmd[0] === bunExe() ? 2 : 5);
  const prefix = new RegExp(root.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return stdout
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => line.replace(prefix, ""))
    .concat(hasCrashed ? [`exit code ${exitCode}, signal ${signalCode}`] : []);
}

/** Returns the lines `cmd` prints, as `linesIn` does. */
export async function linesOf(cmd: string[], cwd: string, root: string) {
  return linesIn(await outputOf(cmd, cwd), cmd, root);
}

/**
 * The file checked first enters each cycle: type parameter variances, recursive aliases, and functions and constants
 * without annotations, each through a cycle of `n` modules. What tsc reports depends on `--checkers`.
 */
export function modulesInCycles(n: number) {
  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const [a, b, d] = [(i + 1) % n, (i + 7) % n, (i * 3 + 2) % n];
    files[`m${i}.ts`] = [
      ...[...new Set([a, b, d])]
        .filter(j => j !== i)
        .map(j => `import { f${j}, g${j}, C${j}, v${j}, type T${j}, type R${j} } from "./m${j}";`),
      `export interface T${i}<A> { a: A; next: T${a}<A[]> | null; take(x: T${b}<A>): void; give(): T${d}<A> }`,
      `export type R${i}<X, N extends unknown[] = []> = N["length"] extends 6 ? X : R${a}<{ m${i}: X }, [...N, 1]>;`,
      `export function f${i}(x: number) { return x > 0 ? { k: "m${i}" as const, inner: f${a}(x - 1) } : null; }`,
      `export function g${i}(x: number) { return ${i === 0 ? "x" : `{ k: ${i}, inner: g${Math.floor(i / 2)}(x) }`}; }`,
      `export class C${i}<A> { constructor(public v: A) {} map<B>(h: (a: A) => B): C${b}<B> { return new C${b}(h(this.v)); } }`,
      `export const v${i} = new C${a}(${i}).map(x => [x, v${d}] as const);`,
      // Assigning to `never` makes the messages print the types.
      `const r${i}: never = f${d}(1);`,
      `const s${i}: never = g${b}(1);`,
      `const t${i}: T${a}<string> = null! as T${a}<unknown>;`,
      `const u${i}: T${b}<unknown> = null! as T${b}<string>;`,
      `const w${i}: never = null! as R${d}<${i}>;`,
      `const y${i}: never = v${b};`,
      `r${i}; s${i}; t${i}; u${i}; w${i}; y${i};\n`,
    ].join("\n");
  }
  return files;
}

/** Calls `run` for each of `items`, `width` at a time. The next one starts when one finishes, not when a batch does. */
export async function inBatches<T>(items: T[], run: (item: T) => Promise<void>) {
  let next = 0;
  const take = async () => {
    try {
      while (next < items.length) await run(items[next++]);
    } finally {
      // Nothing starts after one has failed.
      next = items.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, take));
}

/**
 * `deep`: nested too deeply for an unoptimized build's stack, or too slow in one.
 * `theirs`: what TypeScript 7.1 reports, where `bun check` follows it and the installed tsc reports something else.
 */
type Case = { files: Record<string, string>; build?: true; deep?: true; theirs?: string[] };

/** Writes `files` to `directory`. Returns false if the file system rejects one of their names. */
function write(directory: string, files: Record<string, string>) {
  try {
    for (const path in files) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), files[path]);
    }
    return true;
  } catch (error) {
    // APFS rejects a character that's newer than the system's Unicode tables.
    if ((error as NodeJS.ErrnoException).code === "EILSEQ") return false;
    throw error;
  }
}

/** Returns the programs of differential-cases.json that this build and system can check, each written to `root`/name. */
export async function writtenCases(root: string, isWanted: (it: Case, index: number) => boolean) {
  const all: Record<string, Case> = await Bun.file(join(import.meta.dir, "differential-cases.json")).json();
  return (
    Object.entries(all)
      .filter(([, it]) => !(it.deep && (isDebug || isASAN)))
      .filter(([, it], index) => isWanted(it, index))
      // Windows can't create a directory named `c:` or `w*d`.
      .filter(([, it]) => !isWindows || !Object.keys(it.files).some(path => /[:*?"<>|]/.test(path)))
      .filter(([name, it]) => write(join(root, name), it.files))
  );
}

/**
 * Small programs on which `bun check` and tsc once disagreed, each named after where it was found.
 * A program takes three processes, and a test file has three minutes, so each file tests one of `parts` parts.
 */
export function programsThatOnceDiffered(part: number, parts: number) {
  const tests = 4;
  // `bun test` kills the children of a test that timed out. The rest of its programs must not start beside the next
  // test.
  afterEach(endChecks);
  for (let nth = 0; nth < tests; nth++) {
    // Not `test.concurrent`: each test keeps every core busy by itself. Beside the other three, each would take as long
    // as the whole file, and a test only has 90 seconds.
    test.skipIf(!tsc)(
      `matches tsc on programs where the two once disagreed, ${part * tests + nth + 1} of ${parts * tests}`,
      async () => {
        using dir = tempDir("bun-check-differential", {});
        // tsc gets its own copy, so it doesn't have to wait for the others: `tsc -b` writes files.
        const [bun, typescript] = [join(String(dir), "bun"), join(String(dir), "tsc")];
        // A debug build checks a sample, always the same one.
        const every = isDebug || isASAN ? 40 : 1;
        const cases = await writtenCases(
          bun,
          (_, index) => index % every === 0 && (index / every) % (parts * tests) === part * tests + nth,
        );
        const different: Record<string, object> = {};
        let reported = 0;
        await inBatches(cases, async ([name, it]) => {
          const build = it.build ? ["-b"] : [];
          // What it prints, and whether it fails. tsc exits with 2 if it wrote files despite errors.
          const outcomeOf = async (cmd: string[], root: string) => {
            const output = await outputOf(cmd, join(root, name));
            return { lines: linesIn(output, cmd, root), fails: output.exitCode !== 0 };
          };
          // tsc doesn't run where its output is stored. It fails if it reports anything.
          if (!it.theirs) write(join(typescript, name), it.files);
          // One thread splits the files up differently.
          const [ours, onOneThread, theirs] = await Promise.all([
            outcomeOf([bunExe(), "check", ...build], bun),
            outcomeOf([bunExe(), "check", ...build, "--threads=1"], bun),
            it.theirs
              ? { lines: it.theirs, fails: it.theirs.length > 0 }
              : outcomeOf([tsc!, ...build, "--pretty", "false", "--singleThreaded"], typescript),
          ]);
          if (theirs.lines.length > 0) reported++;
          if (!Bun.deepEquals(theirs, ours)) different[name] = { theirs, ours };
          else if (!Bun.deepEquals(theirs, onOneThread)) different[name] = { theirs, onOneThread };
        });
        expect(different).toEqual({});
        // The oracle has something to say about most of them.
        expect(reported).toBeGreaterThan(cases.length / 2);
      },
    );
  }
}
