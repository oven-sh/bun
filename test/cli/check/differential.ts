import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { longLimit, spawn } from "../children";

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

/**
 * Returns the lines `cmd` prints, with `root` stripped from paths. A crash prints nothing, so it adds a line with the
 * exit status.
 */
export async function linesOf(cmd: string[], cwd: string, root: string) {
  await using proc = spawn({ timeout: longLimit, cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  // bun crashes with a signal, or with exit code 3 on Windows. tsc exits with 4 if project references form a cycle.
  const hasCrashed = proc.signalCode !== null || exitCode > (cmd[0] === bunExe() ? 2 : 5);
  const prefix = new RegExp(root.replaceAll("\\", "/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return stdout
    .split(/\r?\n/)
    .filter(line => line.trim())
    .map(line => line.replace(prefix, ""))
    .concat(hasCrashed ? [`exit code ${exitCode}, signal ${proc.signalCode}`] : []);
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

/** Calls `run` for each of `items`, a few at a time. */
export async function inBatches<T>(items: T[], run: (item: T) => Promise<void>) {
  for (let at = 0; at < items.length; at += 6) await Promise.all(items.slice(at, at + 6).map(run));
}

/**
 * `deep`: nested too deeply for an unoptimized build's stack, or too slow in one.
 * `theirs`: what TypeScript 7.1 reports, where `bun check` follows it and the installed tsc reports something else.
 */
type Case = { files: Record<string, string>; build?: true; deep?: true; theirs?: string[] };

/** Returns the programs of differential-cases.json that this build and system can check, each written to `root`/name. */
export async function writtenCases(root: string, isWanted: (it: Case, index: number, name: string) => boolean) {
  const all: Record<string, Case> = await Bun.file(join(import.meta.dir, "differential-cases.json")).json();
  return (
    Object.entries(all)
      .filter(([, it]) => !(it.deep && (isDebug || isASAN)))
      .filter(([name, it], index) => isWanted(it, index, name))
      // Windows can't create a directory named `c:` or `w*d`.
      .filter(([, it]) => !isWindows || !Object.keys(it.files).some(path => /[:*?"<>|]/.test(path)))
      .filter(([name, it]) => {
        try {
          for (const path in it.files) {
            mkdirSync(dirname(join(root, name, path)), { recursive: true });
            writeFileSync(join(root, name, path), it.files[path]);
          }
          return true;
        } catch (error) {
          // APFS rejects a character that's newer than the system's Unicode tables.
          if ((error as NodeJS.ErrnoException).code === "EILSEQ") return false;
          throw error;
        }
      })
  );
}

// `ONLY=import-type bun bd test test/cli/check/differential-cases-1.test.ts` checks the programs with that text in
// their name, on a debug build too. The first test checks them all, and the others are skipped.
const only = process.env.ONLY;

/**
 * Small programs on which `bun check` and tsc once disagreed, each named after where it was found.
 * A program takes two processes, and a test file has three minutes, so each file tests one of `parts` parts.
 */
export function programsThatOnceDiffered(part: number, parts: number) {
  const tests = 4;
  for (let nth = 0; nth < tests; nth++) {
    test.skipIf(!tsc || (!!only && part + nth > 0))(
      `matches tsc on programs where the two once disagreed, ${part * tests + nth + 1} of ${parts * tests}`,
      async () => {
        using dir = tempDir("bun-check-differential", {});
        const root = String(dir);
        // A debug build checks a sample, always the same one.
        const every = isDebug || isASAN ? 40 : 1;
        const cases = await writtenCases(root, (_, index, name) =>
          only ? name.includes(only) : index % every === 0 && (index / every) % (parts * tests) === part * tests + nth,
        );
        // A test with no program passes, and `ONLY` may match none.
        if (only) expect(cases.length).toBeGreaterThan(0);
        const different: Record<string, object> = {};
        await inBatches(cases, async ([name, it]) => {
          const cwd = join(root, name);
          const build = it.build ? ["-b"] : [];
          // One thread splits the files up differently.
          const [ours, onOneThread] = await Promise.all([
            linesOf([bunExe(), "check", ...build], cwd, root),
            linesOf([bunExe(), "check", ...build, "--threads=1"], cwd, root),
          ]);
          // tsc runs last, because `tsc -b` writes files.
          const theirs =
            it.theirs ?? (await linesOf([tsc!, ...build, "--pretty", "false", "--singleThreaded"], cwd, root));
          if (!Bun.deepEquals(theirs, ours)) different[name] = { theirs, ours };
          else if (!Bun.deepEquals(theirs, onOneThread)) different[name] = { theirs, onOneThread };
        });
        expect(different).toEqual({});
      },
    );
  }
}
