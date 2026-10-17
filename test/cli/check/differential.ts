import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { longLimit, spawn } from "../children";

// `bun check` follows TypeScript 7, which is a native program next to its `lib.*.d.ts`: `typescript7` in
// test/package.json, beside the `typescript` that has the API in JavaScript. `TSC` is the path of another to compare with.
function nativeTypeScript() {
  if (process.env.TSC) return process.env.TSC;
  try {
    const paths = [dirname(require.resolve("typescript7/package.json"))];
    const name = `@typescript/typescript-${process.platform}-${process.arch}`;
    return join(dirname(require.resolve(`${name}/package.json`, { paths })), "lib", isWindows ? "tsc.exe" : "tsc");
  } catch {
    // There is none for this system.
  }
}
export const tsc = nativeTypeScript();

const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

// tsc is a Go program, and half of the processor time of a small check goes to its garbage collector, at work on every
// core. Here it collects on one thread, and only above a gigabyte. What tsc prints does not change.
const oracle = { ...env, GOMAXPROCS: "1", GOGC: "off", GOMEMLIMIT: "1GiB" };

// A check keeps a processor busy from its start to its end. More of them at a time than there are processors ends none
// of them sooner, and each holds its memory for longer.
const width = availableParallelism();
let running = 0;
const waiting: (() => void)[] = [];

/** What `cmd` prints, and how it ended. It starts when fewer than `width` others run, whichever tests they are of. */
export async function outputOf(cmd: string[], cwd: string) {
  if (running < width) running++;
  // The one that ends gives its place to the one that has waited the longest.
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
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout, exitCode, signalCode: proc.signalCode };
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

/** The lines of `output`, without the path of `root`. And how `cmd` ended, if it crashed: that prints nothing. */
function linesIn({ stdout, exitCode, signalCode }: Awaited<ReturnType<typeof outputOf>>, cmd: string[], root: string) {
  // A crash of bun is a signal, and the exit code 3 on Windows. tsc exits with 4 if project references form a cycle.
  const hasCrashed = signalCode !== null || exitCode > (cmd[0] === bunExe() ? 2 : 5);
  const prefix = new RegExp(root.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return stdout
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => line.replace(prefix, ""))
    .concat(hasCrashed ? [`exit code ${exitCode}, signal ${signalCode}`] : []);
}

/** What `cmd` prints, without the path of `root`. And how it ended, if it crashed: that prints nothing. */
export async function linesOf(cmd: string[], cwd: string, root: string) {
  return linesIn(await outputOf(cmd, cwd), cmd, root);
}

/**
 * Whichever file is checked first enters each cycle: the variances of type parameters, recursive aliases, and functions
 * and constants without annotations, each through a ring of `n` modules. What tsc reports depends on `--checkers`.
 */
export function modulesInRings(n: number) {
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
      // `never` puts the types in the messages.
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

/** `run` for each of `items`, `width` at a time: the next one starts when one is through. */
export async function inTurns<T>(items: T[], run: (item: T) => Promise<void>) {
  let next = 0;
  const take = async () => {
    try {
      while (next < items.length) await run(items[next++]);
    } finally {
      // Nothing starts after one that has failed.
      next = items.length;
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, take));
}

/** `deep`: nested too deeply for the stack of a build that is not optimised, or too slow in one. */
type Case = { files: Record<string, string>; build?: true; deep?: true };

// The tests of a file read them once.
let read: Promise<Record<string, Case>> | undefined;
const programs = (): Promise<Record<string, Case>> =>
  (read ??= Bun.file(join(import.meta.dir, "differential-cases.json")).json());

/** Writes `files` into `directory`. False if the file system refuses one of their names. */
function write(directory: string, files: Record<string, string>) {
  try {
    for (const path in files) {
      mkdirSync(dirname(join(directory, path)), { recursive: true });
      writeFileSync(join(directory, path), files[path]);
    }
    return true;
  } catch (error) {
    // APFS refuses a character that is newer than the Unicode tables of the system.
    if ((error as NodeJS.ErrnoException).code === "EILSEQ") return false;
    throw error;
  }
}

/**
 * Small programs about which `bun check` and tsc once said something else, each named after where it was found.
 * A program takes three processes, and a test file has three minutes: each file tests one part of `parts`.
 */
export function programsThatOnceDiffered(part: number, parts: number) {
  const tests = 4;
  for (let nth = 0; nth < tests; nth++) {
    // In turn, not `test.concurrent`: each keeps every processor busy by itself. Beside the other three, each would
    // take as long as the whole file, of the 90 seconds that a test has.
    test.skipIf(!tsc)(
      `programs about which the two once differed, ${part * tests + nth + 1} of ${parts * tests}`,
      async () => {
        const all = await programs();
        using dir = tempDir("bun-check-differential", {});
        // tsc has a copy of its own, so that it does not wait for the others: `tsc -b` writes files.
        const [bun, typescript] = [join(String(dir), "bun"), join(String(dir), "tsc")];
        const cases = Object.entries(all)
          .filter(([, it]) => !(it.deep && (isDebug || isASAN)))
          // A debug build checks a sample. It is always the same sample.
          .filter((_, index) => index % (isDebug || isASAN ? 40 : 1) === 0)
          .filter((_, index) => index % (parts * tests) === part * tests + nth)
          // Windows cannot create a directory named `c:` or `w*d`.
          .filter(([, it]) => !isWindows || !Object.keys(it.files).some(path => /[:*?"<>|]/.test(path)));
        const different: Record<string, object> = {};
        let reported = 0;
        await inTurns(cases, async ([name, it]) => {
          if (!write(join(bun, name), it.files) || !write(join(typescript, name), it.files)) return;
          const build = it.build ? ["-b"] : [];
          // What it prints, and whether it fails. tsc exits with 2 if it has written files in spite of errors.
          const outcomeOf = async (cmd: string[], root: string) => {
            const output = await outputOf(cmd, join(root, name));
            return { lines: linesIn(output, cmd, root), fails: output.exitCode !== 0 };
          };
          // One thread divides the files in another way.
          const [ours, onOneThread, theirs] = await Promise.all([
            outcomeOf([bunExe(), "check", ...build], bun),
            outcomeOf([bunExe(), "check", ...build, "--threads=1"], bun),
            outcomeOf([tsc!, ...build, "--pretty", "false", "--singleThreaded"], typescript),
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
